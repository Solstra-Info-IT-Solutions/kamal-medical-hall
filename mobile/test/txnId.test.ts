import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { extractTransactionId } from '../src/core/txnId';

describe('transaction id from a payment screenshot', () => {
  it('Google Pay', () => assert.equal(extractTransactionId('Payment successful\n₹ 450\nPaid to Kamal Medical Hall\nUPI transaction ID\n412345678901\nFrom: HDFC Bank 1234'), '412345678901'));
  it('PhonePe', () => assert.equal(extractTransactionId('Payment Successful\n₹450\nTransaction ID\nT2410081234567890123\nUTR: 412345678901\nPaid to'), '412345678901'));
  it('PhonePe with only its own id', () => assert.equal(extractTransactionId('Paid ₹450\nTransaction ID T24100812345678901234\nDebited from XXXX1234'), 'T24100812345678901234'));
  it('Paytm', () => assert.equal(extractTransactionId('Paid Successfully\nUPI Ref No: 412345678901\nOrder ID: 20241008111212800110168'), '412345678901'));
  it('BHIM / bank apps', () => assert.equal(extractTransactionId('Transaction Ref. No. 412345678901\nDate 08 Oct 2026'), '412345678901'));
  it('reads an O that should be a zero inside the number', () => assert.equal(extractTransactionId('UTR No: 4123456O8901'), '412345608901'));
  it('falls back to a long number when nothing is labelled', () => assert.equal(extractTransactionId('Success\n₹450\n412345678901\n08 Oct, 10:42 am'), '412345678901'));
  it('returns nothing for a screenshot without an id', () => { assert.equal(extractTransactionId('Hello\n₹450\n08 Oct 2026'), null); assert.equal(extractTransactionId(''), null); });
});
