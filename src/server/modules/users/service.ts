import { User } from '../../../../db';
import { encryptPII, decryptPII } from '../../../../lib/crypto';

// User profile + PromptPay (PII) handling. PromptPay is encrypted at rest.
export abstract class UserService {
  static async getByLineId(lineId: string): Promise<any | null> {
    const user = await User.findOne({ lineId });
    if (!user) return null;
    const u = user.toObject() as any;
    if (u.promptPay) u.promptPay = decryptPII(u.promptPay);
    return u;
  }

  static async setPaymentInfo(lineId: string, promptPay?: string) {
    return User.findOneAndUpdate(
      { lineId },
      { promptPay: promptPay ? encryptPII(promptPay.trim()) : '' },
      { new: true }
    );
  }
}
