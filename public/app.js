import { generatePromptPayQR } from './lib/promptpay.js?v=1';

// Detect LINE in-app browser
const isInLineApp = /Line/i.test(navigator.userAgent);

// State Management
let currentUser = null;
let currentGroupId = 'g-test';
let groupMembers = [];
let activeBillTab = 'equal'; // 'equal' or 'manual'
let manualItems = [];

const fmt = (n) => Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ----------------------------------------------------
// Light / Dark theme toggle (default theme is set in <head> before paint)
// ----------------------------------------------------
(function initThemeToggle() {
  const root = document.documentElement;
  const btn = document.getElementById('theme-toggle');
  const syncIcon = () => { if (btn) btn.textContent = root.dataset.theme === 'dark' ? '☀️' : '🌙'; };
  syncIcon();
  if (btn) {
    btn.addEventListener('click', () => {
      const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
      root.dataset.theme = next;
      try { localStorage.setItem('theme', next); } catch (e) {}
      syncIcon();
    });
  }
})();

// ----------------------------------------------------
// PromptPay EMVCo Generator (Dynamic Amount QR)
// Pure payload logic lives in ./lib/promptpay.js (shared with tests).
// ----------------------------------------------------
function drawQRCode(payload, canvasId) {
  const canvas = document.getElementById(canvasId);
  const ctx = canvas.getContext('2d');
  
  // Use loaded qrcode-generator
  const qr = qrcode(0, 'M');
  qr.addData(payload);
  qr.make();
  
  const size = canvas.width;
  const qrSize = qr.getModuleCount();
  const cellSize = size / qrSize;

  ctx.clearRect(0, 0, size, size);
  
  // Draw QR Modules
  for (let row = 0; row < qrSize; row++) {
    for (let col = 0; col < qrSize; col++) {
      ctx.fillStyle = qr.isDark(row, col) ? '#000000' : '#FFFFFF';
      ctx.fillRect(col * cellSize, row * cellSize, cellSize, cellSize);
    }
  }
}

// ----------------------------------------------------
// Main App UI Logic
// ----------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  // Elements
  const groupTitle = document.getElementById('liff-group-name');
  const groupSubtitle = document.getElementById('liff-group-subtitle');
  const userBadgePic = document.getElementById('liff-user-pic');
  const userBadgeName = document.getElementById('liff-user-name');
  const summaryByPayer = document.getElementById('summary-by-payer');
  const dailyBillsList = document.getElementById('daily-bills-list');
  const fabBtn = document.getElementById('fab-create-bill');

  // Home view + group management elements
  const viewHome = document.getElementById('view-home');
  const viewGroup = document.getElementById('view-group');
  const btnBackHome = document.getElementById('btn-back-home');
  const myGroupsList = document.getElementById('my-groups-list');
  // Create group dialog
  const createGroupDialog = document.getElementById('create-group-dialog');
  const createGroupDialogTitle = document.getElementById('create-group-dialog-title');
  const createGroupForm = document.getElementById('create-group-form');
  const createGroupInviteStep = document.getElementById('create-group-invite-step');
  const newGroupNameInput = document.getElementById('new-group-name');
  const createdInviteLinkText = document.getElementById('created-invite-link-text');
  const btnCopyCreatedInvite = document.getElementById('btn-copy-created-invite');
  const btnCloseAfterCreate = document.getElementById('btn-close-after-create');
  const btnOpenCreatedGroup = document.getElementById('btn-open-created-group');
  const btnCancelCreate = document.getElementById('btn-cancel-create');
  const btnCloseCreateGroup = document.getElementById('btn-close-create-group');
  // Invite members dialog (from inside a group)
  const inviteDialog = document.getElementById('invite-dialog');
  const inviteLinkText = document.getElementById('invite-link-text');
  const btnCopyInvite = document.getElementById('btn-copy-invite');
  const btnShareInvite = document.getElementById('btn-share-invite');
  const btnInviteMembers = document.getElementById('btn-invite-members');

  const PLACEHOLDER_PIC = 'https://api.dicebear.com/7.x/adventurer/svg?seed=placeholder';
  let liffId = 'mock-liff-id';
  let liffInitialized = false;
  let currentGroup = null; // { inviteCode, isLineGroup, name }
  
  // Create Bill Dialog Elements
  const createBillDialog = document.getElementById('create-bill-dialog');
  const createBillForm = document.getElementById('create-bill-form');
  const billNameInput = document.getElementById('bill-name');
  const billDateInput = document.getElementById('bill-date');
  const billPayerSelect = document.getElementById('bill-payer');
  const tabEqual = document.getElementById('tab-equal');
  const tabManual = document.getElementById('tab-manual');
  const sectionEqual = document.getElementById('section-equal');
  const sectionManual = document.getElementById('section-manual');
  const subtotalEqualInput = document.getElementById('bill-subtotal-equal');
  const selectAllEqualBtn = document.getElementById('btn-select-all-equal');
  const payeeListEqual = document.getElementById('payee-list-equal');
  const manualItemsList = document.getElementById('manual-items-list');
  const addManualItemBtn = document.getElementById('btn-add-manual-item');
  const manualSubtotalDisplay = document.getElementById('manual-subtotal-display');
  
  // Taxes / Fees Dialog Elements
  const chkDiscount = document.getElementById('chk-discount');
  const groupDiscount = document.getElementById('group-discount');
  const valDiscount = document.getElementById('val-discount');
  const chkSC = document.getElementById('chk-service-charge');
  const groupSC = document.getElementById('group-service-charge');
  const valSC = document.getElementById('val-service-charge');
  const chkVAT = document.getElementById('chk-vat');
  const groupVAT = document.getElementById('group-vat');
  const valVAT = document.getElementById('val-vat');

  // Summary block
  const summarySubtotal = document.getElementById('summary-subtotal');
  const summaryDiscountLine = document.getElementById('summary-discount-line');
  const summaryDiscount = document.getElementById('summary-discount');
  const summarySCLine = document.getElementById('summary-sc-line');
  const summarySC = document.getElementById('summary-sc');
  const summaryVATLine = document.getElementById('summary-vat-line');
  const summaryVAT = document.getElementById('summary-vat');
  const summaryTotal = document.getElementById('summary-total');

  // Payment Dialog Elements
  const paymentDialog = document.getElementById('payment-dialog');
  const payPayerPic = document.getElementById('pay-payer-pic');
  const payPayerName = document.getElementById('pay-payer-name');
  const payAmountDisplay = document.getElementById('pay-amount-display');
  const payPpNumber = document.getElementById('pay-pp-number');
  const btnCopyPp = document.getElementById('btn-copy-pp');
  const payQrContainer = document.getElementById('pay-qr-container');
  const btnSaveQr = document.getElementById('btn-save-qr');
  const btnConfirmPayment = document.getElementById('btn-confirm-payment');

  // Slip upload / viewer elements
  const slipFileInput = document.getElementById('slip-file-input');
  const slipUploadBtn = document.getElementById('slip-upload-btn');
  const slipUploadText = document.getElementById('slip-upload-text');
  const slipPreviewWrap = document.getElementById('slip-preview-wrap');
  const slipPreview = document.getElementById('slip-preview');
  const slipRemoveBtn = document.getElementById('slip-remove-btn');
  const slipViewOverlay = document.getElementById('slip-view-overlay');
  const slipViewImg = document.getElementById('slip-view-img');
  const slipsGalleryDialog = document.getElementById('slips-gallery-dialog');
  const slipsGalleryGrid = document.getElementById('slips-gallery-grid');
  const slipsGalleryTitle = document.getElementById('slips-gallery-title');
  let pendingSlipFile = null;

  // Settings Dialog Elements
  const settingsDialog = document.getElementById('settings-dialog');
  const settingsForm = document.getElementById('settings-form');
  const settingsNameInput = document.getElementById('settings-display-name');
  const settingsPpInput = document.getElementById('settings-promptpay');
  const openSettingsBtn = document.getElementById('open-settings-btn');

  let activePaymentContext = null;

  // Initialize LIFF SDK once
  const ensureLiff = async () => {
    if (liffInitialized) return;
    const configRes = await fetch('/api/config');
    const config = await configRes.json();
    liffId = config.liffId;
    await liff.init({ liffId: config.liffId });
    liffInitialized = true;
  };

  // Read a query param, also checking LIFF's wrapped `liff.state`
  const getQueryParam = (name) => {
    const search = new URLSearchParams(window.location.search);
    const direct = search.get(name);
    if (direct) return direct;
    const state = search.get('liff.state');
    if (state) {
      const inner = new URLSearchParams(state.startsWith('?') ? state.slice(1) : state);
      return inner.get(name);
    }
    return null;
  };

  const groupHeaderActions = document.getElementById('group-header-actions');
  const btnMoreMenu = document.getElementById('btn-more-menu');
  const moreMenuDropdown = document.getElementById('more-menu-dropdown');

  // Switch between Home and Group views
  const showView = (view) => {
    if (view === 'home') {
      viewHome.hidden = false;
      viewGroup.hidden = true;
      fabBtn.style.display = 'none';
      btnBackHome.hidden = true;
      groupTitle.textContent = 'My Groups';
      groupSubtitle.textContent = 'Select or create a group';
      groupHeaderActions.hidden = true;
    } else {
      viewHome.hidden = true;
      viewGroup.hidden = false;
      fabBtn.style.display = '';
      btnBackHome.hidden = false;
      groupHeaderActions.hidden = false;
    }
  };

  // More menu toggle
  btnMoreMenu.addEventListener('click', (e) => {
    e.stopPropagation();
    moreMenuDropdown.hidden = !moreMenuDropdown.hidden;
  });
  document.addEventListener('click', () => { moreMenuDropdown.hidden = true; });

  // Clipboard helper — works in LINE in-app browser via execCommand fallback
  const copyToClipboard = async (text, btn, doneLabel = 'Copied! ✅', origLabel = null) => {
    const original = origLabel ?? btn.textContent;
    let ok = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        ok = true;
      }
    } catch (_) {}
    if (!ok) {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;left:-9999px;top:-9999px;opacity:0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        ok = document.execCommand('copy');
        document.body.removeChild(ta);
      } catch (_) {}
    }
    if (ok) {
      btn.textContent = doneLabel;
      setTimeout(() => { btn.textContent = original; }, 1600);
    } else {
      alert(`Copy this link:\n\n${text}`);
    }
  };

  // Open a specific group's bill-splitting view
  const openGroup = async (key) => {
    currentGroupId = key;
    showView('group');
    await refreshAllData();
  };

  // Open the "My Groups" home screen
  const openHome = async () => {
    showView('home');
    await loadMyGroups();
  };

  const liffApp = document.getElementById('liff-app-content');

  // Initialize: authenticate via LINE LIFF, then go to My Groups home.
  // The only exception is an ?invite= deep-link, which joins a group first.
  const initApp = async () => {
    try {
      await ensureLiff();
      const profile = await liff.getProfile();
      currentUser = profile;

      liffApp.hidden = false;
      userBadgePic.src = profile.pictureUrl || PLACEHOLDER_PIC;
      userBadgeName.textContent = profile.displayName;
      billDateInput.value = new Date().toISOString().substring(0, 10);

      const invite = getQueryParam('invite');
      if (invite) {
        await joinViaInvite(invite);
      } else {
        await openHome();
      }
    } catch (err) {
      console.error('LIFF initialization failed:', err);
    }
  };

  // ----------------------------------------------------
  // My Groups + invite-link flows
  // ----------------------------------------------------
  const loadMyGroups = async () => {
    myGroupsList.innerHTML = '<div class="chat-system-msg">Loading your groups...</div>';
    try {
      const res = await fetch(`/api/users/${currentUser.userId}/groups`);
      const data = await res.json();

      if (!data.groups || data.groups.length === 0) {
        myGroupsList.innerHTML = '<div class="chat-system-msg">🐾 No groups yet. Create one to get started!</div>';
        return;
      }

      myGroupsList.innerHTML = '';
      data.groups.forEach(g => {
        const card = document.createElement('div');
        card.className = 'group-list-card';
        const avatars = g.members.slice(0, 5)
          .map(m => `<img src="${m.pictureUrl || PLACEHOLDER_PIC}" alt="${m.displayName}" class="group-mini-avatar">`)
          .join('');
        card.innerHTML = `
          <div class="group-list-main">
            <span class="group-list-name">${g.name}</span>
            <span class="group-list-meta">${g.memberCount} member${g.memberCount !== 1 ? 's' : ''}</span>
          </div>
          <div class="group-list-right">
            <div class="group-list-avatars">${avatars}</div>
            <button class="btn-card-copy" title="Copy invite link" type="button">📋</button>
          </div>`;

        // Open group on card click (but not the copy button)
        card.addEventListener('click', (e) => {
          if (!e.target.closest('.btn-card-copy')) openGroup(g.key);
        });

        // Copy invite link button
        const copyBtn = card.querySelector('.btn-card-copy');
        copyBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          copyToClipboard(buildInviteLink(g.inviteCode), copyBtn, '✅', '📋');
        });

        myGroupsList.appendChild(card);
      });
    } catch (err) {
      console.error(err);
      myGroupsList.innerHTML = '<div class="chat-system-msg">Error loading groups.</div>';
    }
  };

  const joinViaInvite = async (code) => {
    try {
      const res = await fetch(`/api/groups/${code}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lineId: currentUser.userId,
          displayName: currentUser.displayName,
          pictureUrl: currentUser.pictureUrl
        })
      });
      if (res.ok) {
        const data = await res.json();
        await openGroup(data.key);
      } else {
        alert('This invite link is invalid or has expired.');
        await openHome();
      }
    } catch (err) {
      console.error(err);
      await openHome();
    }
  };

  const buildInviteLink = (code) => `https://liff.line.me/${liffId}?invite=${code}`;

  const showInviteLink = (code) => {
    const link = buildInviteLink(code);
    inviteLinkText.textContent = link;
    inviteDialog.dataset.link = link;
    inviteDialog.showModal();
  };

  // Back to home (header back button)
  btnBackHome.addEventListener('click', () => openHome());

  // Helper: reset create-group dialog back to step 1
  const resetCreateGroupDialog = () => {
    createGroupForm.hidden = false;
    createGroupInviteStep.hidden = true;
    createGroupDialogTitle.textContent = 'Create New Group';
    newGroupNameInput.value = '';
  };

  // Close / cancel buttons for create-group dialog
  btnCancelCreate.addEventListener('click', () => { createGroupDialog.close(); });
  btnCloseCreateGroup.addEventListener('click', () => { createGroupDialog.close(); });
  btnCloseAfterCreate.addEventListener('click', () => { createGroupDialog.close(); });
  createGroupDialog.addEventListener('close', resetCreateGroupDialog);

  // Create group — step 1 submit
  createGroupForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = newGroupNameInput.value.trim();
    if (!name) return;
    try {
      const res = await fetch('/api/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          lineId: currentUser.userId,
          displayName: currentUser.displayName,
          pictureUrl: currentUser.pictureUrl
        })
      });
      if (res.ok) {
        const data = await res.json();
        // Switch dialog to step 2: show invite link
        createGroupForm.hidden = true;
        createGroupInviteStep.hidden = false;
        createGroupDialogTitle.textContent = 'Group Created! 🎉';
        const link = buildInviteLink(data.inviteCode);
        createdInviteLinkText.textContent = link;
        createGroupInviteStep.dataset.link = link;
        createGroupInviteStep.dataset.key = data.inviteCode;
        await loadMyGroups();
      } else {
        alert('Could not create group. Please try again.');
      }
    } catch (err) {
      console.error(err);
      alert('Error creating group.');
    }
  });

  // Step 2: Copy button inside create-group dialog
  btnCopyCreatedInvite.addEventListener('click', () => {
    copyToClipboard(createGroupInviteStep.dataset.link, btnCopyCreatedInvite, 'Copied! ✅', 'Copy');
  });

  // Step 2: Open Group button
  btnOpenCreatedGroup.addEventListener('click', () => {
    const key = createGroupInviteStep.dataset.key;
    createGroupDialog.close();
    openGroup(key);
  });

  // Invite members (from inside a group)
  btnInviteMembers.addEventListener('click', () => {
    if (currentGroup?.inviteCode) showInviteLink(currentGroup.inviteCode);
  });

  // Copy invite link (invite-dialog)
  btnCopyInvite.addEventListener('click', () => {
    copyToClipboard(inviteDialog.dataset.link, btnCopyInvite, 'Copied! ✅', 'Copy');
  });

  // Share invite link via LINE share picker → Web Share → clipboard
  btnShareInvite.addEventListener('click', async () => {
    const link = inviteDialog.dataset.link;
    const msg = `เหมียว~ มาหารบิลกันใน "ถุงเงิน" เมี้ยว! 🐾 กดลิงก์เพื่อเข้ากลุ่ม:\n${link}`;
    try {
      if (isInLineApp && typeof liff.shareTargetPicker === 'function' && liff.isApiAvailable?.('shareTargetPicker')) {
        await liff.shareTargetPicker([{ type: 'text', text: msg }]);
      } else if (navigator.share) {
        await navigator.share({ text: msg });
      } else {
        copyToClipboard(link, btnShareInvite, 'Link Copied!', 'Share to LINE');
      }
    } catch (err) {
      console.error('Share failed:', err);
    }
  });

  // Skeleton loading helper
  const showSkeleton = (container, rows = 3) => {
    container.innerHTML = Array(rows).fill(0).map(() => `
      <div class="skeleton-block">
        <div class="skeleton-row"></div>
        <div class="skeleton-row short"></div>
      </div>`).join('');
  };

  // Main refresh routine
  const refreshAllData = async () => {
    showSkeleton(summaryByPayer, 2);
    showSkeleton(dailyBillsList, 3);
    await fetchGroupDetails();
    await fetchBillsList();
    updateTaxesSummary();
  };

  // ----------------------------------------------------
  // API Integration: Fetch Group & Balances
  // ----------------------------------------------------
  const fetchGroupDetails = async () => {
    try {
      const res = await fetch(`/api/groups/${currentGroupId}`);
      if (!res.ok) throw new Error("Failed to load group details");

      const data = await res.json();
      groupMembers = data.group.members;
      groupTitle.textContent = data.group.name;
      const maxAvatars = 8;
      const avatarHtml = groupMembers.slice(0, maxAvatars)
        .map(m => `<img src="${m.pictureUrl || PLACEHOLDER_PIC}" alt="${m.displayName}" class="header-member-avatar">`)
        .join('');
      const overflow = groupMembers.length - maxAvatars;
      const overflowHtml = overflow > 0 ? `<span class="header-member-more">+${overflow}</span>` : '';
      groupSubtitle.innerHTML = `<div class="header-member-stack">${avatarHtml}${overflowHtml}</div>`;

      // Track current group for the Invite button
      currentGroup = {
        inviteCode: data.group.inviteCode,
        isLineGroup: !!data.group.lineGroupId,
        name: data.group.name
      };
      btnInviteMembers.style.visibility = currentGroup.inviteCode ? 'visible' : 'hidden';

      // Update settings dialog name field
      settingsNameInput.value = currentUser.displayName;
      const currentDbUser = groupMembers.find(m => m.lineId === currentUser.userId);
      settingsPpInput.value = currentDbUser?.promptPay || '';

      // Populate Payer Select inside Create Bill dialog
      billPayerSelect.innerHTML = '';
      groupMembers.forEach(member => {
        const opt = document.createElement('option');
        opt.value = member.lineId;
        opt.textContent = member.promptPay ? member.displayName : `${member.displayName} (no PromptPay)`;
        opt.dataset.hasPromptpay = member.promptPay ? '1' : '';
        if (member.lineId === currentUser.userId) {
          opt.selected = true;
        }
        billPayerSelect.appendChild(opt);
      });

    } catch (err) {
      console.error(err);
      groupTitle.textContent = "Error Loading Group";
    }
  };

  // ----------------------------------------------------
  // Summary: by Date → by Payer (collapsible)
  // ----------------------------------------------------
  const renderSummary = (dailyGroups) => {
    summaryByPayer.innerHTML = '';

    if (dailyGroups.length === 0) {
      summaryByPayer.innerHTML = '<div class="chat-system-msg">🐾 No bills yet.</div>';
      return;
    }

    let renderedAny = false;
    dailyGroups.forEach(dayGroup => {
      // Only summarize bills that still need settling (skip paid & cancelled)
      const payerMap = new Map();
      for (const bill of dayGroup.bills) {
        if (bill.status !== 'unpaid') continue;
        const key = bill.payerId._id;
        if (!payerMap.has(key)) {
          payerMap.set(key, { payer: bill.payerId, totalPaid: 0, bills: [] });
        }
        const entry = payerMap.get(key);
        entry.totalPaid += bill.totalAmount;
        entry.bills.push(bill);
      }
      if (payerMap.size === 0) return;

      const dateSection = document.createElement('div');
      dateSection.className = 'summary-date-section';

      const dateLabel = new Date(dayGroup.date + 'T12:00:00').toLocaleDateString('en-US', {
        weekday: 'long', year: 'numeric', month: 'short', day: 'numeric'
      });
      dateSection.innerHTML = `<div class="summary-date-label">${dateLabel}</div>`;

      payerMap.forEach(({ payer, totalPaid, bills: payerBills }) => {
        const uid = `sp-${payer._id}-${dayGroup.date}`;
        const block = document.createElement('div');
        block.className = 'summary-payer-block';

        // Find current user's unpaid total + bill IDs for this payer/day
        let myUnpaidTotal = 0;
        const myUnpaidBillIds = [];
        if (currentUser && payer.lineId !== currentUser.userId) {
          payerBills.forEach(bill => {
            const myEntry = bill.payees.find(
              p => p.payeeId.lineId === currentUser.userId && p.status === 'unpaid'
            );
            if (myEntry) {
              myUnpaidTotal += myEntry.amount;
              myUnpaidBillIds.push(bill._id);
            }
          });
        }

        // Build payee rows (exclude payer's own share)
        let detailsHTML = '';
        payerBills.forEach(bill => {
          const others = bill.payees.filter(p => p.payeeId._id !== payer._id);
          if (others.length === 0) return;
          detailsHTML += `<div class="summary-bill-label">${bill.name}</div>`;
          others.forEach(p => {
            const isMe = currentUser && p.payeeId.lineId === currentUser.userId;
            detailsHTML += `
              <div class="summary-payee-item ${isMe ? 'is-me' : ''}">
                <div class="summary-payee-left">
                  <img src="${p.payeeId.pictureUrl}" alt="${p.payeeId.displayName}" class="summary-mini-avatar">
                  <span>${p.payeeId.displayName}${isMe ? ' <span class="me-tag">(you)</span>' : ''}</span>
                </div>
                <div class="summary-payee-right">
                  <span class="summary-payee-amount">${fmt(p.amount)} THB</span>
                  <span class="badge ${p.status}">${p.status}</span>
                </div>
              </div>`;
          });
        });

        const payAllBtnHTML = myUnpaidBillIds.length > 0
          ? `<button class="btn btn-primary btn-block btn-pay-all-summary" style="margin-top:10px">Pay ${fmt(myUnpaidTotal)} THB</button>`
          : '';

        block.innerHTML = `
          <div class="summary-payer-header">
            <div class="summary-payer-info">
              <img src="${payer.pictureUrl}" alt="${payer.displayName}" class="summary-payer-avatar">
              <span class="summary-payer-name">${payer.displayName} <span class="payer-tag">paid</span></span>
            </div>
            <div class="summary-payer-meta">
              <span class="summary-payer-total">${fmt(totalPaid)} THB</span>
              <span class="summary-chevron">▾</span>
            </div>
          </div>
          ${payAllBtnHTML}
          <div class="summary-payer-details" id="${uid}"><div class="summary-payer-details-inner">
            ${detailsHTML || '<div class="summary-no-others">No one else owes for this.</div>'}
          </div></div>`;

        // Toggle expand/collapse (header only, not the Pay All button)
        block.querySelector('.summary-payer-header').addEventListener('click', (e) => {
          if (e.target.closest('.btn-pay-all-summary')) return;
          const details = document.getElementById(uid);
          const chevron = block.querySelector('.summary-chevron');
          const open = details.classList.toggle('active');
          chevron.textContent = open ? '▴' : '▾';
        });

        // Pay All button
        const payAllBtn = block.querySelector('.btn-pay-all-summary');
        if (payAllBtn) {
          payAllBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            openPaymentModal(payer, myUnpaidTotal, myUnpaidBillIds);
          });
        }

        dateSection.appendChild(block);
      });

      summaryByPayer.appendChild(dateSection);
      renderedAny = true;
    });

    if (!renderedAny) {
      summaryByPayer.innerHTML = '<div class="chat-system-msg">🐾 All settled — purr-fect!</div>';
    }
  };

  // Build a single bill card element with its expand/collapse wired up.
  const createBillCard = (bill) => {
    const cardWrapper = document.createElement('div');
    cardWrapper.className = 'bill-card-wrapper';

    let badgeClass = 'unpaid';
    if (bill.status === 'paid') badgeClass = 'paid';
    if (bill.status === 'cancelled') badgeClass = 'cancelled';

    cardWrapper.innerHTML = `
      <div class="bill-card-header" id="bill-header-${bill._id}">
        <div class="bill-card-left">
          <div class="payer-pic-container">
            <img src="${bill.payerId.pictureUrl}" alt="${bill.payerId.displayName}">
          </div>
          <div class="bill-title-container">
            <span class="bill-title">${bill.name}</span>
            <span class="bill-payer-label">Paid by ${bill.payerId.displayName}</span>
          </div>
        </div>
        <div class="bill-card-right">
          <span class="bill-amount">${fmt(bill.totalAmount)} THB</span>
          <span class="badge ${badgeClass}">${bill.status}</span>
        </div>
      </div>
      <div class="bill-card-details" id="bill-details-${bill._id}"><div class="bill-card-details-inner"></div></div>
    `;

    cardWrapper.querySelector(`#bill-header-${bill._id}`).addEventListener('click', () => {
      const detailsDiv = cardWrapper.querySelector(`#bill-details-${bill._id}`);
      const inner = detailsDiv.querySelector('.bill-card-details-inner');
      detailsDiv.classList.toggle('active');
      if (detailsDiv.classList.contains('active') && !inner.hasChildNodes()) {
        renderBillDetails(bill, inner);
      }
    });

    return cardWrapper;
  };

  // Build a day card (header + bill cards). Day-level actions (Remind / Cancel All)
  // are only shown for the active section, not History.
  const buildDayCard = (dayInfo, { isHistory }) => {
    const dayCard = document.createElement('div');
    dayCard.className = `day-group${isHistory ? ' day-group-history' : ''}`;

    const dateOptions = { weekday: 'long', year: 'numeric', month: 'short', day: 'numeric' };
    const dateLabel = new Date(dayInfo.date).toLocaleDateString('en-US', dateOptions);

    // Recompute totals & payer strings from the bills actually shown
    let total = 0;
    const payerMap = new Map();
    dayInfo.bills.forEach(b => {
      if (b.status === 'cancelled') return;
      total += b.totalAmount;
      payerMap.set(b.payerId.displayName, (payerMap.get(b.payerId.displayName) || 0) + b.totalAmount);
    });
    const payerStrings = [...payerMap.entries()].map(([n, amt]) => `${n}: paid ${fmt(amt)}`).join(' · ');

    const hasUnpaidBills = dayInfo.bills.some(b => b.status === 'unpaid');
    const slipCount = dayInfo.bills.reduce(
      (n, b) => n + (b.payees?.filter(p => p.slipKey).length || 0), 0
    );
    const remindBtnHTML = (!isHistory && currentGroup?.isLineGroup)
      ? `<button class="btn btn-small btn-remind-day" data-date="${dayInfo.date}" title="Send reminder to LINE group">📢 Remind</button>`
      : '';
    const cancelDayBtnHTML = (!isHistory && hasUnpaidBills)
      ? `<button class="btn btn-small btn-danger-outline btn-cancel-day" data-date="${dayInfo.date}">Cancel All</button>`
      : '';
    const slipsBtnHTML = slipCount > 0
      ? `<button class="btn btn-small btn-view-day-slips">📎 Slips (${slipCount})</button>`
      : '';

    dayCard.innerHTML = `
      <div class="day-header">
        <span class="day-header-left">${dateLabel}</span>
        <div class="day-header-right">
          <span class="day-total-text">Total: ${fmt(total)} THB</span>
          <span class="day-payers-list">${payerStrings}</span>
          <div class="day-header-actions">
            ${slipsBtnHTML}
            ${remindBtnHTML}
            ${cancelDayBtnHTML}
          </div>
        </div>
      </div>
      <div class="bills-list"></div>
    `;

    // View all slips for this day
    const slipsBtn = dayCard.querySelector('.btn-view-day-slips');
    if (slipsBtn) {
      slipsBtn.addEventListener('click', () => openDaySlipsGallery(dayInfo, dateLabel));
    }

    const listDiv = dayCard.querySelector('.bills-list');
    dayInfo.bills.forEach(bill => listDiv.appendChild(createBillCard(bill)));

    // Remind button: send Flex Message to LINE group for this day
    const remindBtn = dayCard.querySelector('.btn-remind-day');
    if (remindBtn) {
      remindBtn.addEventListener('click', async () => {
        remindBtn.disabled = true;
        remindBtn.textContent = 'Sending...';
        try {
          const res = await fetch(`/api/groups/${currentGroupId}/remind-day`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ date: dayInfo.date })
          });
          const data = await res.json();
          if (!res.ok) {
            alert(`Error: ${data.error}`);
          } else if (!data.sent) {
            alert('ทุกคนจ่ายครบแล้วเมี้ยว ไม่มีอะไรต้องตาม~ 🐾');
          } else {
            remindBtn.textContent = 'Sent! ✅';
            setTimeout(() => { remindBtn.textContent = '📢 Remind'; remindBtn.disabled = false; }, 2000);
            return;
          }
        } catch (err) {
          console.error(err);
          alert('Failed to send reminder.');
        }
        remindBtn.textContent = '📢 Remind';
        remindBtn.disabled = false;
      });
    }

    // Cancel all bills for the day
    const cancelDayBtn = dayCard.querySelector('.btn-cancel-day');
    if (cancelDayBtn) {
      cancelDayBtn.addEventListener('click', async () => {
        if (!confirm(`Cancel ALL unpaid bills on ${dateLabel}? This cannot be undone.`)) return;
        cancelDayBtn.disabled = true;
        cancelDayBtn.textContent = 'Cancelling...';
        try {
          const res = await fetch(`/api/groups/${currentGroupId}/bills/cancel-day`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ date: dayInfo.date })
          });
          if (res.ok) await refreshAllData();
          else alert('Failed to cancel bills.');
        } catch (err) {
          console.error(err);
          alert('Error cancelling bills.');
          cancelDayBtn.disabled = false;
          cancelDayBtn.textContent = 'Cancel All';
        }
      });
    }

    return dayCard;
  };

  // ----------------------------------------------------
  // API Integration: Fetch Bills grouped by Day
  // ----------------------------------------------------
  const fetchBillsList = async () => {
    try {
      const res = await fetch(`/api/groups/${currentGroupId}/bills`);
      if (!res.ok) throw new Error("Failed to load bills");

      const dailyGroups = await res.json();
      renderSummary(dailyGroups);
      dailyBillsList.innerHTML = '';

      if (dailyGroups.length === 0) {
        dailyBillsList.innerHTML = '<div class="chat-system-msg">🐾 No bills yet — tap + to add one!</div>';
        return;
      }

      // Split each day into active (unpaid) and completed (paid/cancelled) bills.
      const activeDays = [];   // { date, bills: [...] }
      const historyDays = [];  // { date, bills: [...] }
      dailyGroups.forEach(dayGroup => {
        const active = dayGroup.bills.filter(b => b.status === 'unpaid');
        const completed = dayGroup.bills.filter(b => b.status === 'paid' || b.status === 'cancelled');
        if (active.length) activeDays.push({ date: dayGroup.date, bills: active });
        if (completed.length) historyDays.push({ date: dayGroup.date, bills: completed });
      });

      // Render active days
      if (activeDays.length === 0) {
        dailyBillsList.innerHTML = '<div class="chat-system-msg">🐾 All settled — purr-fect! Check History below.</div>';
      } else {
        activeDays.forEach(d => dailyBillsList.appendChild(buildDayCard(d, { isHistory: false })));
      }

      // Render collapsible History section
      if (historyDays.length > 0) {
        const totalHistory = historyDays.reduce((n, d) => n + d.bills.length, 0);
        const historySection = document.createElement('div');
        historySection.className = 'history-section';
        historySection.innerHTML = `
          <button class="history-toggle" id="history-toggle" type="button">
            <span>🗂️ History (${totalHistory})</span>
            <span class="history-chevron">▾</span>
          </button>
          <div class="history-body" id="history-body"><div class="history-body-inner"></div></div>
        `;
        dailyBillsList.appendChild(historySection);

        const historyInner = historySection.querySelector('.history-body-inner');
        historyDays.forEach(d => historyInner.appendChild(buildDayCard(d, { isHistory: true })));

        const historyBody = historySection.querySelector('#history-body');
        historySection.querySelector('#history-toggle').addEventListener('click', () => {
          historyBody.classList.toggle('active');
          historySection.querySelector('.history-chevron').classList.toggle('open');
        });
      }

    } catch (err) {
      console.error(err);
      dailyBillsList.innerHTML = '<div class="chat-system-msg">Error loading bills list.</div>';
    }
  };

  // Render expanded bill details
  const renderBillDetails = (bill, container) => {
    container.innerHTML = '';

    // 1. If manual split, display item breakdown list
    if (bill.splitMethod === 'manual' && bill.items?.length > 0) {
      const itemsSec = document.createElement('div');
      itemsSec.className = 'details-items-list';
      itemsSec.innerHTML = '<div class="details-section-title">Itemized Split Details</div>';
      
      bill.items.forEach(item => {
        // Find member display names sharing this item
        const payeesNames = item.payeeIds.map(id => {
          const userObj = groupMembers.find(m => m._id === id);
          return userObj ? userObj.displayName : 'Unknown';
        }).join(', ');

        const itemRow = document.createElement('div');
        itemRow.className = 'details-item-row';
        itemRow.innerHTML = `
          <div>
            <span>${item.name}</span>
            <div class="details-item-payees">Split by: ${payeesNames}</div>
          </div>
          <span>${fmt(item.price)} THB</span>
        `;
        itemsSec.appendChild(itemRow);
      });

      // Add tax rows to breakdown
      if (bill.serviceChargePercent > 0) {
        const scAmount = bill.subtotal * (bill.serviceChargePercent / 100);
        itemsSec.innerHTML += `
          <div class="details-item-row tax-line">
            <span>Service Charge (${bill.serviceChargePercent}%)</span>
            <span>+${fmt(scAmount)} THB</span>
          </div>
        `;
      }
      if (bill.vatPercent > 0) {
        const scAmount = bill.subtotal * (bill.serviceChargePercent / 100);
        const vatAmount = (bill.subtotal + scAmount) * (bill.vatPercent / 100);
        itemsSec.innerHTML += `
          <div class="details-item-row tax-line">
            <span>VAT (${bill.vatPercent}%)</span>
            <span>+${fmt(vatAmount)} THB</span>
          </div>
        `;
      }

      container.appendChild(itemsSec);
    }

    // 2. Display Payees settlement list
    const payeesSec = document.createElement('div');
    payeesSec.className = 'details-payees-list';
    payeesSec.innerHTML = '<div class="details-section-title">Split Breakdown &amp; Status</div>';

    bill.payees.forEach(payee => {
      const payeeRow = document.createElement('div');
      const isUnpaid = payee.status === 'unpaid';
      const isActiveUserPayee = payee.payeeId.lineId === currentUser.userId;
      const isActiveUserPayer = bill.payerId.lineId === currentUser.userId;

      payeeRow.className = `details-payee-row${isActiveUserPayee ? ' is-me' : ''}`;

      const payeeIsPayer = payee.payeeId.lineId === bill.payerId.lineId;
      let actionBtn = '';
      if (isUnpaid && !payeeIsPayer) {
        if (isActiveUserPayee) {
          // It's my own share — pay it
          actionBtn = `<button class="btn btn-secondary btn-small btn-pay-payee" data-amount="${payee.amount}" data-payee="${payee.payeeId.lineId}">Pay</button>`;
        } else if (isActiveUserPayer) {
          // I'm the payer and received cash from this friend — settle manually
          actionBtn = `<button class="btn btn-secondary btn-small btn-settle-payee" data-user-id="${payee.payeeId.lineId}">Mark Paid</button>`;
        } else {
          // Pay on behalf of a friend (row already shows whose share it is)
          actionBtn = `<button class="btn btn-secondary btn-small btn-pay-payee" data-amount="${payee.amount}" data-payee="${payee.payeeId.lineId}" title="Pay for ${payee.payeeId.displayName}">Pay</button>`;
        }
      }

      const slipBtn = payee.slipKey
        ? `<button class="btn btn-secondary btn-small btn-view-slip" data-slip="${payee.slipKey}">📎 Slip</button>`
        : '';

      payeeRow.innerHTML = `
        <div class="details-payee-user">
          <img src="${payee.payeeId.pictureUrl}" alt="${payee.payeeId.displayName}">
          <span>${payee.payeeId.displayName}${isActiveUserPayee ? ' <span class="me-tag">(you)</span>' : ''}</span>
        </div>
        <div class="details-payee-status">
          <span>${fmt(payee.amount)} THB</span>
          <span class="badge ${payee.status}">${payee.status}</span>
          ${slipBtn}
          ${actionBtn}
        </div>
      `;
      payeesSec.appendChild(payeeRow);
    });

    // View slip buttons
    payeesSec.querySelectorAll('.btn-view-slip').forEach(btn => {
      btn.addEventListener('click', () => openSlipViewer(btn.getAttribute('data-slip')));
    });

    container.appendChild(payeesSec);

    // Bind events for payee click triggers
    container.querySelectorAll('.btn-pay-payee').forEach(btn => {
      btn.addEventListener('click', () => {
        openPaymentModal(
          bill.payerId,
          parseFloat(btn.getAttribute('data-amount')),
          [bill._id],
          btn.getAttribute('data-payee')
        );
      });
    });

    container.querySelectorAll('.btn-settle-payee').forEach(btn => {
      btn.addEventListener('click', async () => {
        const friendLineId = btn.getAttribute('data-user-id');
        if (confirm(`Confirm you received payment from this friend?`)) {
          await markPortionAsPaid(bill._id, friendLineId);
        }
      });
    });

    // 3. Admin Action Bar for Payer or Creator (Edit + Cancel)
    const canManageBill = bill.status === 'unpaid' && (
      bill.payerId.lineId === currentUser.userId ||
      bill.createdById?.lineId === currentUser.userId
    );
    if (canManageBill) {
      const actionBar = document.createElement('div');
      actionBar.className = 'bill-action-bar';
      actionBar.innerHTML = `
        <button class="btn btn-secondary btn-small" id="btn-edit-${bill._id}">✏️ Edit</button>
        <button class="btn btn-warning btn-small" id="btn-cancel-${bill._id}">❌ Cancel Bill</button>`;
      container.appendChild(actionBar);

      document.getElementById(`btn-edit-${bill._id}`).addEventListener('click', () => {
        openEditBillDialog(bill);
      });

      document.getElementById(`btn-cancel-${bill._id}`).addEventListener('click', async () => {
        if (confirm(`Are you sure you want to cancel the bill "${bill.name}"? This cannot be undone.`)) {
          await cancelBill(bill._id);
        }
      });
    }
  };

  // ----------------------------------------------------
  // Actions: Pay portion / Cancel Bill / Remind
  // ----------------------------------------------------
  const markPortionAsPaid = async (billId, payeeLineId) => {
    try {
      const res = await fetch(`/api/bills/${billId}/pay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payeeLineId })
      });
      if (res.ok) {
        alert("Payment registered successfully.");
        await refreshAllData();
      }
    } catch (err) {
      console.error(err);
      alert("Error processing payment.");
    }
  };

  const cancelBill = async (billId) => {
    try {
      const res = await fetch(`/api/bills/${billId}/cancel`, { method: 'POST' });
      if (res.ok) {
        alert("Bill cancelled successfully.");
        await refreshAllData();
      }
    } catch (err) {
      console.error(err);
      alert("Error cancelling bill.");
    }
  };

  // Open the create-bill-dialog pre-filled for editing
  let editingBillId = null;
  const openEditBillDialog = (bill) => {
    editingBillId = bill._id;
    renderEqualSplitChecklist();
    manualItems = [];

    billNameInput.value = bill.name;
    billDateInput.value = bill.date;

    // Set payer
    Array.from(billPayerSelect.options).forEach(opt => {
      opt.selected = (opt.value === bill.payerId.lineId);
    });

    // Discount
    if (bill.discountAmount > 0) {
      chkDiscount.checked = true;
      groupDiscount.classList.remove('disabled');
      valDiscount.value = bill.discountAmount;
    } else {
      chkDiscount.checked = false;
      groupDiscount.classList.add('disabled');
      valDiscount.value = '0';
    }

    // Service charge
    if (bill.serviceChargePercent > 0) {
      chkSC.checked = true;
      groupSC.classList.remove('disabled');
      valSC.value = bill.serviceChargePercent;
    } else {
      chkSC.checked = false;
      groupSC.classList.add('disabled');
    }

    // VAT
    if (bill.vatPercent > 0) {
      chkVAT.checked = true;
      groupVAT.classList.remove('disabled');
      valVAT.value = bill.vatPercent;
    } else {
      chkVAT.checked = false;
      groupVAT.classList.add('disabled');
    }

    if (bill.splitMethod === 'equal') {
      activeBillTab = 'equal';
      tabEqual.classList.add('active');
      tabManual.classList.remove('active');
      sectionEqual.classList.add('active');
      sectionManual.classList.remove('active');

      subtotalEqualInput.value = bill.subtotal;

      // Pre-check payees
      const payeeIds = bill.payees.map(p => p.payeeId.lineId);
      payeeListEqual.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        cb.checked = payeeIds.includes(cb.value);
      });
      updateSelectAllBtn();
    } else {
      activeBillTab = 'manual';
      tabManual.classList.add('active');
      tabEqual.classList.remove('active');
      sectionManual.classList.add('active');
      sectionEqual.classList.remove('active');

      manualItems = (bill.items || []).map(item => ({
        id: Date.now() + Math.random(),
        name: item.name,
        price: item.price,
        payeeLineIds: item.payeeIds.map(id => {
          const m = groupMembers.find(m => m._id === id);
          return m ? m.lineId : null;
        }).filter(Boolean)
      }));
      if (manualItems.length === 0) addManualItem();
      else renderManualItemsList();
    }

    updateTaxesSummary();
    document.querySelector('#create-bill-dialog .dialog-header h2').textContent = 'Edit Bill';
    document.getElementById('btn-save-bill').textContent = 'Save Changes';
    createBillDialog.showModal();
  };

  // ----------------------------------------------------
  // Create Bill Form logic: Tabs and Inputs
  // ----------------------------------------------------
  tabEqual.addEventListener('click', () => {
    activeBillTab = 'equal';
    tabEqual.classList.add('active');
    tabManual.classList.remove('active');
    sectionEqual.classList.add('active');
    sectionManual.classList.remove('active');
    updateTaxesSummary();
  });

  tabManual.addEventListener('click', () => {
    activeBillTab = 'manual';
    tabManual.classList.add('active');
    tabEqual.classList.remove('active');
    sectionManual.classList.add('active');
    sectionEqual.classList.remove('active');
    
    // Initialize manual items array if empty
    if (manualItems.length === 0) {
      addManualItem();
    }
    updateTaxesSummary();
  });

  // Checkbox behaviors for discount / tax modifiers
  chkDiscount.addEventListener('change', () => {
    if (chkDiscount.checked) {
      groupDiscount.classList.remove('disabled');
    } else {
      groupDiscount.classList.add('disabled');
    }
    updateTaxesSummary();
  });

  valDiscount.addEventListener('input', updateTaxesSummary);

  chkSC.addEventListener('change', () => {
    if (chkSC.checked) {
      groupSC.classList.remove('disabled');
    } else {
      groupSC.classList.add('disabled');
    }
    updateTaxesSummary();
  });

  valSC.addEventListener('input', updateTaxesSummary);

  chkVAT.addEventListener('change', () => {
    if (chkVAT.checked) {
      groupVAT.classList.remove('disabled');
    } else {
      groupVAT.classList.add('disabled');
    }
    updateTaxesSummary();
  });

  valVAT.addEventListener('input', updateTaxesSummary);
  subtotalEqualInput.addEventListener('input', updateTaxesSummary);

  // Equal split checklist generation
  const renderEqualSplitChecklist = () => {
    payeeListEqual.innerHTML = '';
    groupMembers.forEach(member => {
      const label = document.createElement('label');
      label.className = 'checkbox-label';
      label.innerHTML = `
        <input type="checkbox" name="payee-equal" value="${member.lineId}" checked>
        <span>${member.displayName}</span>
      `;
      payeeListEqual.appendChild(label);
      label.querySelector('input').addEventListener('change', () => { updateSelectAllBtn(); updateTaxesSummary(); });
    });
    updateSelectAllBtn();
  };

  const updateSelectAllBtn = () => {
    const checkBoxes = payeeListEqual.querySelectorAll('input[type="checkbox"]');
    const allChecked = checkBoxes.length > 0 && Array.from(checkBoxes).every(cb => cb.checked);
    selectAllEqualBtn.textContent = allChecked ? 'Deselect All' : 'Select All';
  };

  selectAllEqualBtn.addEventListener('click', () => {
    const checkBoxes = payeeListEqual.querySelectorAll('input[type="checkbox"]');
    const allChecked = Array.from(checkBoxes).every(cb => cb.checked);
    checkBoxes.forEach(cb => cb.checked = !allChecked);
    updateSelectAllBtn();
    updateTaxesSummary();
  });

  // Manual items manager
  const addManualItem = () => {
    const newItem = {
      id: Date.now() + Math.random(),
      name: '',
      price: 0,
      payeeLineIds: groupMembers.map(m => m.lineId) // default all
    };
    manualItems.push(newItem);
    renderManualItemsList();
    updateTaxesSummary();
  };

  addManualItemBtn.addEventListener('click', addManualItem);

  const renderManualItemsList = () => {
    manualItemsList.innerHTML = '';
    
    manualItems.forEach((item, idx) => {
      const itemRow = document.createElement('div');
      itemRow.className = 'manual-item-row';
      
      // Payee checkboxes for this specific item
      let checkboxesHTML = '';
      groupMembers.forEach(m => {
        const isChecked = item.payeeLineIds.includes(m.lineId) ? 'checked' : '';
        checkboxesHTML += `
          <label class="checkbox-label">
            <input type="checkbox" data-user-id="${m.lineId}" ${isChecked}>
            <span>${m.displayName}</span>
          </label>
        `;
      });

      itemRow.innerHTML = `
        <div class="item-main-row">
          <input type="text" class="item-name-input" value="${item.name}" placeholder="Item ${idx+1} name">
          <input type="number" class="item-price-input" value="${item.price || ''}" step="0.01" min="0.01" placeholder="Price">
          <button type="button" class="btn-remove-item" ${manualItems.length === 1 ? 'disabled' : ''}>&times;</button>
        </div>
        <div class="item-payee-selector">
          <span class="item-payee-selector-title">Share among:</span>
          <div class="item-payee-checkboxes">
            ${checkboxesHTML}
          </div>
        </div>
      `;

      manualItemsList.appendChild(itemRow);

      // Event listener for item input name
      itemRow.querySelector('.item-name-input').addEventListener('input', (e) => {
        item.name = e.target.value;
      });

      // Event listener for item input price
      itemRow.querySelector('.item-price-input').addEventListener('input', (e) => {
        item.price = parseFloat(e.target.value) || 0;
        updateTaxesSummary();
      });

      // Remove item event
      itemRow.querySelector('.btn-remove-item').addEventListener('click', () => {
        if (manualItems.length > 1) {
          manualItems.splice(idx, 1);
          renderManualItemsList();
          updateTaxesSummary();
        }
      });

      // Payee change events for this item
      itemRow.querySelectorAll('.item-payee-checkboxes input').forEach(cb => {
        cb.addEventListener('change', () => {
          const userId = cb.getAttribute('data-user-id');
          if (cb.checked) {
            if (!item.payeeLineIds.includes(userId)) {
              item.payeeLineIds.push(userId);
            }
          } else {
            item.payeeLineIds = item.payeeLineIds.filter(id => id !== userId);
          }
          updateTaxesSummary();
        });
      });
    });
  };

  // Perform tax updates and grand totals
  function updateTaxesSummary() {
    let subtotal = 0;

    if (activeBillTab === 'equal') {
      subtotal = parseFloat(subtotalEqualInput.value) || 0;
    } else {
      subtotal = manualItems.reduce((sum, item) => sum + item.price, 0);
      manualSubtotalDisplay.textContent = `${fmt(subtotal)} THB`;
    }

    // Apply discount
    const discountAmt = chkDiscount.checked ? Math.max(0, parseFloat(valDiscount.value) || 0) : 0;
    const discountedSubtotal = Math.max(0, subtotal - discountAmt);

    // Apply SC & VAT on discounted amount
    let scPercent = chkSC.checked ? (parseFloat(valSC.value) || 0) : 0;
    let vatPercent = chkVAT.checked ? (parseFloat(valVAT.value) || 0) : 0;

    let scAmount = discountedSubtotal * (scPercent / 100);
    let vatAmount = (discountedSubtotal + scAmount) * (vatPercent / 100);
    let grandTotal = discountedSubtotal + scAmount + vatAmount;

    // Render summaries
    summarySubtotal.textContent = `${fmt(subtotal)} THB`;

    if (chkDiscount.checked && discountAmt > 0) {
      summaryDiscountLine.style.display = 'flex';
      summaryDiscount.textContent = `-${fmt(discountAmt)} THB`;
    } else {
      summaryDiscountLine.style.display = 'none';
    }

    if (chkSC.checked) {
      summarySCLine.style.display = 'flex';
      summarySC.textContent = `+${fmt(scAmount)} THB`;
    } else {
      summarySCLine.style.display = 'none';
    }

    if (chkVAT.checked) {
      summaryVATLine.style.display = 'flex';
      summaryVAT.textContent = `+${fmt(vatAmount)} THB`;
    } else {
      summaryVATLine.style.display = 'none';
    }

    summaryTotal.textContent = `${fmt(grandTotal)} THB`;
  }

  const resetCreateBillDialog = () => {
    editingBillId = null;
    document.querySelector('#create-bill-dialog .dialog-header h2').textContent = 'Create New Bill';
    document.getElementById('btn-save-bill').textContent = 'Save Bill';
    renderEqualSplitChecklist();
    manualItems = [];
    addManualItem();
    activeBillTab = 'equal';
    tabEqual.classList.add('active');
    tabManual.classList.remove('active');
    sectionEqual.classList.add('active');
    sectionManual.classList.remove('active');
    billNameInput.value = '';
    billDateInput.value = new Date().toISOString().substring(0, 10);
    subtotalEqualInput.value = '';
    chkDiscount.checked = false;
    groupDiscount.classList.add('disabled');
    valDiscount.value = '0';
    chkSC.checked = false;
    groupSC.classList.add('disabled');
    chkVAT.checked = false;
    groupVAT.classList.add('disabled');
    updateTaxesSummary();
  };

  createBillDialog.addEventListener('close', () => {
    if (editingBillId) resetCreateBillDialog();
  });

  // Handle Dialog Launching
  fabBtn.addEventListener('click', () => {
    resetCreateBillDialog();
  });

  // ----------------------------------------------------
  // Form submission: Create Bill in DB
  // ----------------------------------------------------
  createBillForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const name = billNameInput.value.trim();
    const date = billDateInput.value;
    const payerLineId = billPayerSelect.value;

    // Validate: the payer must have a PromptPay number set up, otherwise
    // friends have no way to settle the bill through the app.
    const payerMember = groupMembers.find(m => m.lineId === payerLineId);
    if (!payerMember?.promptPay) {
      alert(`${payerMember?.displayName || 'The selected payer'} has not set up PromptPay yet. They need to add it (⚙️ Setup PromptPay) before being set as the payer.`);
      return;
    }

    const discountAmount = chkDiscount.checked ? Math.max(0, parseFloat(valDiscount.value) || 0) : 0;
    const scPercent = chkSC.checked ? parseFloat(valSC.value) : 0;
    const vatPercent = chkVAT.checked ? parseFloat(valVAT.value) : 0;

    let payload = {
      groupKey: currentGroupId,
      name,
      date,
      payerLineId,
      creatorLineId: currentUser.userId,
      splitMethod: activeBillTab,
      discountAmount,
      vatPercent,
      serviceChargePercent: scPercent
    };

    if (activeBillTab === 'equal') {
      const equalSubtotal = parseFloat(subtotalEqualInput.value);
      const checkedPayees = Array.from(payeeListEqual.querySelectorAll('input:checked')).map(cb => cb.value);
      
      if (checkedPayees.length === 0) {
        alert("Please select at least one payee to split equally.");
        return;
      }

      payload.subtotal = equalSubtotal;
      payload.payeeLineIds = checkedPayees;
    } else {
      // Manual items list validation
      const itemsPayload = manualItems.map(item => ({
        name: item.name.trim(),
        price: item.price,
        payeeLineIds: item.payeeLineIds
      }));

      const hasInvalidItem = itemsPayload.some(item => !item.name || item.price <= 0);
      if (hasInvalidItem) {
        alert("Every item must have a name and a price greater than 0.");
        return;
      }
      const hasEmptyPayees = itemsPayload.some(item => item.payeeLineIds.length === 0);
      if (hasEmptyPayees) {
        alert("Every item must have at least one payee checked.");
        return;
      }

      payload.items = itemsPayload;
    }

    try {
      const url = editingBillId ? `/api/bills/${editingBillId}` : '/api/bills';
      const method = editingBillId ? 'PATCH' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        createBillDialog.close();
        await refreshAllData();
      } else {
        const err = await res.json();
        alert(`Error: ${err.error}`);
      }
    } catch (err) {
      console.error(err);
      alert(editingBillId ? "Error updating bill." : "Error creating bill.");
    }
  });

  // ----------------------------------------------------
  // Payment Modal logic & PromptPay QR rendering
  // ----------------------------------------------------
  // billIds is an array; pass [] to show modal without confirm button.
  // payeeLineId is who the payment settles for (defaults to the active user).
  const openPaymentModal = (payer, amount, billIds = [], payeeLineId = currentUser.userId) => {
    activePaymentContext = { payer, amount, billIds, payeeLineId };
    
    payPayerPic.src = payer.pictureUrl;
    payPayerName.textContent = payer.displayName;
    payAmountDisplay.textContent = `${fmt(amount)} THB`;

    if (!payer.promptPay) {
      // If payer has not configured payment info
      payPpNumber.textContent = 'Not configured ⚠️';
      payPpNumber.classList.add('negative');
      btnCopyPp.disabled = true;
      payQrContainer.style.display = 'none';
    } else {
      // PromptPay configured!
      payPpNumber.textContent = formatPromptPayNumber(payer.promptPay);
      payPpNumber.classList.remove('negative');
      btnCopyPp.disabled = false;
      payQrContainer.style.display = 'flex';
      
      // Generate dynamically the EMVCo QR Code payload
      const qrPayload = generatePromptPayQR(payer.promptPay, amount);
      if (qrPayload) {
        drawQRCode(qrPayload, 'qr-canvas');
      } else {
        console.error("Failed to generate PromptPay payload");
        payQrContainer.style.display = 'none';
      }

    }

    // Reset slip upload state
    resetSlipUpload();

    // Show confirm button + slip upload only when there are bills to mark paid AND payer has PromptPay
    if (billIds.length > 0) {
      btnConfirmPayment.style.display = 'block';
      btnConfirmPayment.disabled = !payer.promptPay;
      btnConfirmPayment.title = payer.promptPay ? '' : `${payer.displayName} has not set up PromptPay yet`;
      slipUploadSection.style.display = payer.promptPay ? 'block' : 'none';
    } else {
      btnConfirmPayment.style.display = 'none';
      btnConfirmPayment.disabled = false;
      slipUploadSection.style.display = 'none';
    }

    paymentDialog.showModal();
  };

  // ---- Slip upload handling ----
  const slipUploadSection = document.getElementById('slip-upload-section');

  function resetSlipUpload() {
    pendingSlipFile = null;
    if (slipFileInput) slipFileInput.value = '';
    if (slipPreviewWrap) slipPreviewWrap.hidden = true;
    if (slipPreview) slipPreview.src = '';
    if (slipUploadText) slipUploadText.textContent = 'Attach payment slip (optional)';
  }

  // Trigger the (body-level) file input from the button inside the dialog.
  if (slipUploadBtn) {
    slipUploadBtn.addEventListener('click', () => slipFileInput && slipFileInput.click());
  }

  if (slipFileInput) {
    slipFileInput.addEventListener('change', () => {
      const file = slipFileInput.files?.[0];
      if (!file) { resetSlipUpload(); return; }
      if (!file.type.startsWith('image/')) { alert('Please select an image file.'); resetSlipUpload(); return; }
      if (file.size > 8 * 1024 * 1024) { alert('Image too large (max 8MB).'); resetSlipUpload(); return; }
      pendingSlipFile = file;
      slipPreview.src = URL.createObjectURL(file);
      slipPreviewWrap.hidden = false;
      slipUploadText.textContent = 'Change slip';
    });
  }
  if (slipRemoveBtn) slipRemoveBtn.addEventListener('click', resetSlipUpload);

  // Upload the pending slip (if any) to R2, returning its object key or null.
  const uploadPendingSlip = async () => {
    if (!pendingSlipFile) return null;
    const fd = new FormData();
    fd.append('slip', pendingSlipFile);
    const res = await fetch('/api/slips', { method: 'POST', body: fd });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Slip upload failed');
    }
    const data = await res.json();
    return data.key;
  };

  // ---- Slip viewer ----
  const openSlipViewer = (slipKey) => {
    slipViewImg.src = `/api/slip?key=${encodeURIComponent(slipKey)}`;
    slipViewOverlay.showModal();
  };
  const closeSlipViewer = () => {
    slipViewOverlay.close();
    slipViewImg.src = '';
  };

  // ---- Day slips gallery ----
  const openDaySlipsGallery = (dayInfo, dateLabel) => {
    slipsGalleryTitle.textContent = `Slips · ${dateLabel}`;
    slipsGalleryGrid.innerHTML = '';

    const entries = [];
    dayInfo.bills.forEach(bill => {
      (bill.payees || []).forEach(p => {
        if (p.slipKey) {
          entries.push({
            slipKey: p.slipKey,
            payeeName: p.payeeId.displayName,
            payeePic: p.payeeId.pictureUrl,
            billName: bill.name,
            amount: p.amount
          });
        }
      });
    });

    if (entries.length === 0) {
      slipsGalleryGrid.innerHTML = '<div class="chat-system-msg">No slips uploaded for this day.</div>';
    } else {
      entries.forEach(e => {
        const card = document.createElement('div');
        card.className = 'slip-gallery-card';
        card.innerHTML = `
          <img class="slip-gallery-thumb" src="/api/slip?key=${encodeURIComponent(e.slipKey)}" alt="Slip">
          <div class="slip-gallery-meta">
            <img src="${e.payeePic}" alt="${e.payeeName}">
            <div>
              <div class="slip-gallery-name">${e.payeeName}</div>
              <div class="slip-gallery-sub">${e.billName} · ${fmt(e.amount)} THB</div>
            </div>
          </div>
        `;
        card.querySelector('.slip-gallery-thumb').addEventListener('click', () => openSlipViewer(e.slipKey));
        slipsGalleryGrid.appendChild(card);
      });
    }

    slipsGalleryDialog.showModal();
  };
  if (slipViewOverlay) {
    document.getElementById('slip-view-close').addEventListener('click', closeSlipViewer);
    // Click on the backdrop (the dialog element itself) closes the viewer
    slipViewOverlay.addEventListener('click', (e) => {
      if (e.target === slipViewOverlay) closeSlipViewer();
    });
    // Reset src when closed via Esc / back gesture
    slipViewOverlay.addEventListener('close', () => { slipViewImg.src = ''; });
  }

  // Helper to format PromptPay string nicely
  function formatPromptPayNumber(num) {
    if (num.length === 10) {
      return `${num.substring(0,3)}-${num.substring(3,6)}-${num.substring(6)}`;
    } else if (num.length === 13) {
      return `${num.substring(0,1)}-${num.substring(1,5)}-${num.substring(5,10)}-${num.substring(10,12)}-${num.substring(12)}`;
    }
    return num;
  }

  // Handle clipboard copies
  btnCopyPp.addEventListener('click', () => {
    if (activePaymentContext?.payer?.promptPay) {
      copyToClipboard(activePaymentContext.payer.promptPay, btnCopyPp, 'Copied! ✅', 'Copy Number');
    }
  });

  // Handle Saving QR code image
  const qrSaveOverlay = document.getElementById('qr-save-overlay');
  const qrSaveImg = document.getElementById('qr-save-img');
  document.getElementById('qr-save-close').addEventListener('click', () => { qrSaveOverlay.hidden = true; });

  btnSaveQr.addEventListener('click', () => {
    const canvas = document.getElementById('qr-canvas');
    const dataUrl = canvas.toDataURL('image/png');
    if (isInLineApp) {
      // Close payment dialog first so overlay isn't behind it
      paymentDialog.close();
      qrSaveImg.src = dataUrl;
      qrSaveOverlay.hidden = false;
    } else {
      const link = document.createElement('a');
      link.download = `PromptPay_ThungNgoen_${activePaymentContext?.amount.toFixed(2)}.png`;
      link.href = dataUrl;
      link.click();
    }
  });

  // Settlement Confirm Payment — handles single or multiple bills at once
  btnConfirmPayment.addEventListener('click', async () => {
    const ctx = activePaymentContext;
    if (!ctx || ctx.billIds.length === 0) return;

    btnConfirmPayment.disabled = true;
    btnConfirmPayment.textContent = 'Processing...';

    try {
      // Upload the slip once and attach the same key to each settled bill
      let slipKey = null;
      try {
        slipKey = await uploadPendingSlip();
      } catch (err) {
        console.error(err);
        alert('Could not upload the slip. Please try again.');
        return;
      }

      for (const billId of ctx.billIds) {
        await fetch(`/api/bills/${billId}/pay`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ payeeLineId: ctx.payeeLineId || currentUser.userId, slipKey })
        });
      }
      paymentDialog.close();
      await refreshAllData();
    } finally {
      btnConfirmPayment.disabled = false;
      btnConfirmPayment.textContent = 'I have paid this amount';
    }
  });

  // ----------------------------------------------------
  // Payer settings update logic
  // ----------------------------------------------------
  settingsForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const promptPay = settingsPpInput.value.trim();

    if (promptPay.length !== 10 && promptPay.length !== 13) {
      alert("Invalid PromptPay. Must be a 10-digit phone or 13-digit National ID.");
      return;
    }

    try {
      const res = await fetch(`/api/users/${currentUser.userId}/payment-info`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ promptPay })
      });

      if (res.ok) {
        alert("PromptPay payment info saved successfully.");
        settingsDialog.close();
        await refreshAllData();
      } else {
        alert("Error saving settings.");
      }
    } catch (err) {
      console.error(err);
      alert("Failed to save settings.");
    }
  });

  // Populate settings dialog whenever it's about to open
  openSettingsBtn.addEventListener('click', async () => {
    settingsNameInput.value = currentUser?.displayName || '';
    if (currentUser?.userId) {
      try {
        const res = await fetch(`/api/users/${currentUser.userId}`);
        if (res.ok) {
          const data = await res.json();
          settingsPpInput.value = data.user?.promptPay || '';
        }
      } catch (_) {}
    }
  });

  // ----------------------------------------------------
  // Leave / Delete Group
  // ----------------------------------------------------
  const leaveGroup = async () => {
    const name = currentGroup?.name || 'this group';
    if (!confirm(`Leave "${name}"?\n\nYou will be removed from the group. You can rejoin via invite link.`)) return;
    try {
      const res = await fetch(`/api/groups/${currentGroupId}/leave`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lineId: currentUser.userId })
      });
      if (res.ok) {
        await openHome();
      } else {
        const d = await res.json();
        alert(`Error: ${d.error}`);
      }
    } catch (err) {
      console.error(err);
      alert('Failed to leave group.');
    }
  };

  const deleteGroup = async () => {
    const name = currentGroup?.name || 'this group';
    if (!confirm(`Delete "${name}"?\n\nThis will permanently delete the group AND all bills. This cannot be undone.`)) return;
    if (!confirm(`Are you absolutely sure you want to delete "${name}"?`)) return;
    try {
      const res = await fetch(`/api/groups/${currentGroupId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lineId: currentUser.userId })
      });
      if (res.ok) {
        await openHome();
      } else {
        const d = await res.json();
        alert(`Error: ${d.error}`);
      }
    } catch (err) {
      console.error(err);
      alert('Failed to delete group.');
    }
  };

  document.getElementById('btn-leave-group').addEventListener('click', leaveGroup);
  document.getElementById('btn-delete-group').addEventListener('click', deleteGroup);

  // Scroll focused input into view when keyboard opens (fixes LIFF header overlap)
  document.addEventListener('focusin', (e) => {
    if (e.target.matches('input:not([type="checkbox"]), select, textarea')) {
      setTimeout(() => e.target.scrollIntoView({ behavior: 'smooth', block: 'center' }), 350);
    }
  });

  // Initial Boot
  initApp();
});
