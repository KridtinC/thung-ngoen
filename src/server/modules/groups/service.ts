import mongoose from 'mongoose';
import { Group, User } from '../../../../db';
import { LineService } from '../line/service';

export abstract class GroupService {
  // Resolve a group by any public key: LINE group ID, invite code, or Mongo _id.
  static async resolve(key: string, populate = false) {
    let q = Group.findOne({ lineGroupId: key });
    if (populate) q = q.populate('members');
    let group = await q;
    if (group) return group;

    q = Group.findOne({ inviteCode: key });
    if (populate) q = q.populate('members');
    group = await q;
    if (group) return group;

    if (mongoose.Types.ObjectId.isValid(key)) {
      let q2 = Group.findById(key);
      if (populate) q2 = q2.populate('members');
      group = await q2;
      if (group) return group;
    }
    return null;
  }

  // Fetch every member of a LINE group and upsert them into MongoDB.
  static async syncMembers(lineGroupId: string): Promise<void> {
    if (!process.env.LINE_CHANNEL_ACCESS_TOKEN) return;
    try {
      let groupName = `Group (${lineGroupId.substring(0, 8)})`;
      const summary = await LineService.get(`/v2/bot/group/${lineGroupId}/summary`);
      if (summary?.groupName) groupName = summary.groupName;

      const userIds: string[] = [];
      let nextToken: string | undefined;
      do {
        const url = `/v2/bot/group/${lineGroupId}/members/ids${nextToken ? `?start=${nextToken}` : ''}`;
        const page = await LineService.get(url);
        if (!page) break;
        userIds.push(...(page.memberIds || []));
        nextToken = page.next;
      } while (nextToken);

      const memberIds: mongoose.Types.ObjectId[] = [];
      for (const userId of userIds) {
        const profile = await LineService.get(`/v2/bot/group/${lineGroupId}/member/${userId}`);
        if (!profile) continue;
        const user = await User.findOneAndUpdate(
          { lineId: userId },
          { displayName: profile.displayName, pictureUrl: profile.pictureUrl || '' },
          { upsert: true, new: true }
        );
        memberIds.push(user._id as mongoose.Types.ObjectId);
      }

      let group = await Group.findOne({ lineGroupId });
      if (!group) {
        await Group.create({ lineGroupId, name: groupName, members: memberIds });
      } else {
        group.name = groupName;
        const existing = new Set((group.members as any[]).map((m: any) => m.toString()));
        for (const id of memberIds) {
          if (!existing.has(id.toString())) (group.members as any[]).push(id);
        }
        await group.save();
      }
      console.log(`✅ Synced ${memberIds.length} members for group: ${groupName}`);
    } catch (err) {
      console.error('syncGroupMembers error:', err);
    }
  }
}
