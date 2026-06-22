// PromptPay EMVCo payload generator (pure — no DOM).
// Shared by the LIFF client (app.js) and the test suite.

// CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF), uppercase 4-hex.
export function crc16(str) {
  let crc = 0xFFFF;
  for (let c = 0; c < str.length; c++) {
    let charCode = str.charCodeAt(c);
    crc ^= (charCode << 8);
    for (let i = 0; i < 8; i++) {
      if (crc & 0x8000) {
        crc = (crc << 1) ^ 0x1021;
      } else {
        crc = crc << 1;
      }
      crc &= 0xFFFF;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

// Build an EMVCo PromptPay payload for a phone (10 digits) or National ID (13 digits).
// Returns the full payload string (incl. CRC), or null for an invalid target length.
export function generatePromptPayQR(target, amount) {
  // Clean phone / National ID
  let formattedTarget = target.replace(/[^0-9]/g, '');
  let targetType = '';

  if (formattedTarget.length === 10) {
    targetType = '01'; // Mobile
    formattedTarget = '0066' + formattedTarget.substring(1);
  } else if (formattedTarget.length === 13) {
    targetType = '02'; // National ID
  } else {
    return null; // Invalid target length
  }

  const aid = 'A000000677010111';
  // Sub-tag 00: AID
  const subTag00 = '00' + String(aid.length).padStart(2, '0') + aid;
  // Sub-tag 01/02: Target ID
  const subTag01or02 = targetType + String(formattedTarget.length).padStart(2, '0') + formattedTarget;

  // Tag 29: Merchant Info
  const tag29Value = subTag00 + subTag01or02;
  const tag29 = '29' + String(tag29Value.length).padStart(2, '0') + tag29Value;

  // Tag 00: Version
  const tag00 = '000201';
  // Tag 01: Initiation method - 11 (Static) or 12 (Dynamic amount)
  const tag01 = amount ? '010212' : '010211';
  // Tag 53: Currency (764 = THB)
  const tag53 = '5303764';
  // Tag 54: Amount (2 decimal places)
  let tag54 = '';
  if (amount) {
    const amtStr = parseFloat(amount).toFixed(2);
    tag54 = '54' + String(amtStr.length).padStart(2, '0') + amtStr;
  }
  // Tag 58: Country (TH)
  const tag58 = '5802TH';

  // Combine elements
  const rawPayload = tag00 + tag01 + tag29 + tag53 + tag54 + tag58 + '6304';
  const checksum = crc16(rawPayload);

  return rawPayload + checksum;
}
