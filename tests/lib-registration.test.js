import { test, eq } from './harness.js';
import {
  PSEUDO_DOMAIN, cleanNationalId, formatEmployeeCode, isEmployeeKind, isPseudoEmail, loginEmail,
  maskNationalId, nameToPseudoEmail, pseudoEmail, toAsciiDigits, validEmail, validNationalId,
  validateRegistration,
} from '../js/lib/registration.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const employeeTitle = { id: 't-emp', name: 'Employee', kind: 'employee' };
const supervisorTitle = { id: 't-sup', name: 'Supervisor', kind: 'supervision' };
const managerTitle = { id: 't-mgr', name: 'Manager', kind: 'management' };

// A registration payload that passes every rule.
const validRegistration = {
  title: employeeTitle,
  fullName: 'Sara Ahmed Mahmoud',
  nationalId: '29912121234565',
  email: '',
  managerId: 'm1',
  supervisorCount: 2,
  password: 'secret1',
  confirm: 'secret1',
};
const validate = (changes = {}) => validateRegistration({ ...validRegistration, ...changes });

// Arabic-Indic (U+0660..U+0669) and Persian (U+06F0..U+06F9) digits, built from
// code points so the reader never has to trust how an editor renders them.
const digit = (n) => String.fromCharCode(0x0660 + n);
const persianDigit = (n) => String.fromCharCode(0x06f0 + n);
const arabic = (ascii) => [...ascii].map((c) => (c >= '0' && c <= '9' ? digit(Number(c)) : c)).join('');
const persian = (ascii) => [...ascii].map((c) => (c >= '0' && c <= '9' ? persianDigit(Number(c)) : c)).join('');

const ARABIC_NID = arabic('29912121234565');      // 14 digits with spaces/dashes removed
const ARABIC_SPACED = arabic('2991 2121-234565'); // same id, typed with separators
const PERSIAN_NID = persian('29912121234565');

const BULLET = String.fromCharCode(0x2022); // the mask character
const EM_DASH = String.fromCharCode(0x2014); // shown when there is no id

const ARABIC_NAME = String.fromCharCode(0x623, 0x62d, 0x645, 0x62f, 0x20, 0x62d, 0x633, 0x646); // Arabic letters
const ARABIC_FULL_NAME = String.fromCharCode(0x633, 0x627, 0x631, 0x629, 0x20, 0x623, 0x62d, 0x645, 0x62f, 0x20, 0x645, 0x62d, 0x645, 0x648, 0x62f);

// ---------------------------------------------------------------------------
// toAsciiDigits
// ---------------------------------------------------------------------------
test('toAsciiDigits: Arabic-Indic digits map by code point, not by position', () => {
  eq(toAsciiDigits(arabic('0123456789')), '0123456789');
  eq(toAsciiDigits(arabic('29912121234565')), '29912121234565');
  eq(toAsciiDigits(arabic('0991')), '0991');   // 0x0669 must not be clamped to 0x0660
  eq(toAsciiDigits(arabic('9000')), '9000');
});

test('toAsciiDigits: Persian digits map by code point too', () => {
  eq(toAsciiDigits(persian('0123456789')), '0123456789');
  eq(toAsciiDigits(persian('29912121234565')), '29912121234565');
});

test('toAsciiDigits: both alphabets can appear in one string', () => {
  eq(toAsciiDigits(digit(2) + digit(9) + persianDigit(1) + persianDigit(5)), '2915');
});

test('toAsciiDigits: leaves Latin text, letters and symbols untouched', () => {
  eq(toAsciiDigits('Sara 123 @x.y'), 'Sara 123 @x.y');
  eq(toAsciiDigits(arabic('2026') + '-10'), '2026-10');
  eq(toAsciiDigits(String.fromCharCode(0x66a)), String.fromCharCode(0x66a)); // Arabic percent sign is not a digit
  eq(toAsciiDigits(String.fromCharCode(0x660 - 1)), String.fromCharCode(0x660 - 1)); // one below the range
  eq(toAsciiDigits(String.fromCharCode(0x66a)), String.fromCharCode(0x66a)); // one above the range
});

test('toAsciiDigits: null, undefined and non-strings never throw', () => {
  eq(toAsciiDigits(null), '');
  eq(toAsciiDigits(undefined), '');
  eq(toAsciiDigits(''), '');
  eq(toAsciiDigits(0), '0');
  eq(toAsciiDigits(12345), '12345');
  eq(toAsciiDigits(29912121234565), '29912121234565'); // beyond 2^53 must not lose digits
  eq(toAsciiDigits(false), 'false');
});

// ---------------------------------------------------------------------------
// cleanNationalId
// ---------------------------------------------------------------------------
test('cleanNationalId: strips spaces, tabs, newlines and dashes after normalising digits', () => {
  eq(cleanNationalId('29912121234565'), '29912121234565');
  eq(cleanNationalId(' 2991 2121 234565 '), '29912121234565');
  eq(cleanNationalId('2991-2121-234565'), '29912121234565');
  eq(cleanNationalId('2991 2121-234565'), '29912121234565');
  eq(cleanNationalId('2991\t2121\n234565'), '29912121234565');
  eq(cleanNationalId(ARABIC_SPACED), '29912121234565');
});

test('cleanNationalId: does not remove other separators or letters', () => {
  eq(cleanNationalId('2991.2121.234565'), '2991.2121.234565');
  eq(cleanNationalId('2991_2121_234565'), '2991_2121_234565');
  eq(cleanNationalId('abc'), 'abc');
  eq(cleanNationalId(null), '');
  eq(cleanNationalId(undefined), '');
});

// ---------------------------------------------------------------------------
// validNationalId — positive / negative / edge
// ---------------------------------------------------------------------------
test('validNationalId: accepts real dates in both centuries (2=1900s, 3=2000s)', () => {
  eq(validNationalId('29912121234565'), true);   // 1999-12-12
  eq(validNationalId('25001011234567'), true);   // 1950-01-01
  eq(validNationalId('30001011234567'), true);   // 2000-01-01
  eq(validNationalId('30112311234567'), true);   // 2001-12-31, last day of the year
});

test('validNationalId: rejects wrong length, wrong century digit and non-digits', () => {
  eq(validNationalId('2991212123456'), false);      // 13 digits
  eq(validNationalId('299121212345678'), false);    // 15 digits
  eq(validNationalId('19901011234567'), false);     // century 1
  eq(validNationalId('49901011234567'), false);     // century 4
  eq(validNationalId('09901011234567'), false);     // century 0
  eq(validNationalId('2991212123456a'), false);     // letter at the end
  eq(validNationalId('a9912121234c65'), false);     // letters inside
  eq(validNationalId('2991+2121234565'), false);    // only spaces and dashes are tolerated
});

test('validNationalId: rejects impossible months and days', () => {
  eq(validNationalId('29913011234567'), false);     // month 13
  eq(validNationalId('29900011234567'), false);     // month 00
  eq(validNationalId('29912001234567'), false);     // day 00
  eq(validNationalId('29901321234567'), false);     // day 32 in a 31-day month
  eq(validNationalId('29904311234567'), false);     // April 31
  eq(validNationalId('29902291234567'), false);     // Feb 29, 1999 (not a leap year)
});

test('validNationalId: leap years — 2000 yes, 1900 no, 2004 yes', () => {
  eq(validNationalId('30002291234567'), true);      // 2000 is a leap year (divisible by 400)
  eq(validNationalId('20002291234567'), false);     // 1900 is not a leap year (divisible by 100)
  eq(validNationalId('30402291234567'), true);      // 2004 is a leap year
  eq(validNationalId('3040229123456'), false);      // 13 digits is still rejected
});

test('validNationalId: boundary days of each month', () => {
  eq(validNationalId('30001311234567'), true);      // Jan 31
  eq(validNationalId('30002311234567'), false);     // Feb 31
  eq(validNationalId('30002301234567'), false);     // Feb 30 (2000 is a leap year, still impossible)
  eq(validNationalId('30004301234567'), true);      // Apr 30
  eq(validNationalId('30004311234567'), false);     // Apr 31
  eq(validNationalId('30006301234567'), true);      // Jun 30
});

test('validNationalId: tolerates Arabic digits, spaces and dashes', () => {
  eq(validNationalId(ARABIC_NID), true);
  eq(validNationalId(PERSIAN_NID), true);
  eq(validNationalId(ARABIC_SPACED), true);
  eq(validNationalId('2 9912 12 1234565'), true);
  eq(validNationalId('2991-2121-234565'), true);
  eq(validNationalId(' 29912121234565 '), true);
});

test('validNationalId: an Arabic id is held to the same rules as an ASCII one', () => {
  eq(validNationalId(arabic('29913011234567')), false);  // month 13
  eq(validNationalId(arabic('19912121234565')), false);  // wrong century
  eq(validNationalId(arabic('2991212123456')), false);   // 13 digits
});

test('validNationalId: empty and non-string input is false, never throws', () => {
  eq(validNationalId(''), false);
  eq(validNationalId('   '), false);
  eq(validNationalId(null), false);
  eq(validNationalId(undefined), false);
  eq(validNationalId(29912121234565), true);        // a number is stringified
  eq(validNationalId({}), false);
  eq(validNationalId([]), false);
});

// ---------------------------------------------------------------------------
// pseudoEmail / isPseudoEmail / PSEUDO_DOMAIN
// ---------------------------------------------------------------------------
test('pseudoEmail: uses the cleaned national id and the reserved invalid domain', () => {
  eq(PSEUDO_DOMAIN, 'staff.invalid');
  eq(pseudoEmail('29912121234565'), '29912121234565@staff.invalid');
  eq(pseudoEmail(' ' + ARABIC_SPACED + ' '), '29912121234565@staff.invalid');
  eq(pseudoEmail('2991 2121 234565'), '29912121234565@staff.invalid');
  eq(pseudoEmail(null), '@staff.invalid');           // the caller is expected to validate the id first
});

test('isPseudoEmail: exact suffix match only, case-insensitive, null-safe', () => {
  eq(isPseudoEmail('29912121234565@staff.invalid'), true);
  eq(isPseudoEmail('29912121234565@STAFF.INVALID'), true);
  eq(isPseudoEmail('29912121234565@Staff.Invalid'), true);
  eq(isPseudoEmail('sara@example.com'), false);
  eq(isPseudoEmail('staff.invalid'), false);               // no @
  eq(isPseudoEmail('x@staff.invalid.example.com'), false); // the suffix must be at the end
  eq(isPseudoEmail('x@notstaff.invalid'), false);
  eq(isPseudoEmail(''), false);
  eq(isPseudoEmail(null), false);
  eq(isPseudoEmail(undefined), false);
  eq(isPseudoEmail(12345), false);
});

// ---------------------------------------------------------------------------
// nameToPseudoEmail
// ---------------------------------------------------------------------------
test('nameToPseudoEmail: "First Last" becomes first.last@staff.invalid', () => {
  eq(nameToPseudoEmail('Ahmed Hassan'), 'ahmed.hassan@staff.invalid');
  eq(nameToPseudoEmail('SARA MOHAMED ALI'), 'sara.mohamed.ali@staff.invalid');
  eq(nameToPseudoEmail('Ahmed   Hassan'), 'ahmed.hassan@staff.invalid');    // runs of spaces collapse to one dot
  eq(nameToPseudoEmail('  Ahmed\tHassan  '), 'ahmed.hassan@staff.invalid'); // tab and padding are whitespace
});

test('nameToPseudoEmail: keeps letters, digits, dot, underscore and dash; drops everything else', () => {
  eq(nameToPseudoEmail("O'Brien-Smith"), 'obrien-smith@staff.invalid');
  eq(nameToPseudoEmail('Ahmed_Hassan'), 'ahmed_hassan@staff.invalid');
  eq(nameToPseudoEmail('Dev1 Team2'), 'dev1.team2@staff.invalid');
  eq(nameToPseudoEmail('Ahmed (Hassan)!'), 'ahmed.hassan@staff.invalid');
  eq(nameToPseudoEmail('a+b@c.com'), 'abc.com@staff.invalid');
});

test('nameToPseudoEmail: Arabic names fall back to "user"', () => {
  // The local part is limited to a-z0-9._-, so Arabic letters are stripped and the spaces
  // that separated them become dots. Only the "user" fallback for a fully empty name
  // catches that; a two-word Arabic name yields the (still email-safe) local part ".".
  eq(nameToPseudoEmail(ARABIC_NAME), '.@staff.invalid');
  eq(nameToPseudoEmail(''), 'user@staff.invalid');
  eq(nameToPseudoEmail('   '), 'user@staff.invalid');
  eq(nameToPseudoEmail('!!!'), 'user@staff.invalid');
  eq(nameToPseudoEmail(null), 'user@staff.invalid');
  eq(nameToPseudoEmail(undefined), 'user@staff.invalid');
});

test('nameToPseudoEmail: the result is always a syntactically valid email', () => {
  const names = ['Ahmed Hassan', ARABIC_NAME, '', '   ', '!!!', null, 'A B C', "O'Brien"];
  for (const name of names) {
    const mail = nameToPseudoEmail(name);
    eq(mail.endsWith('@' + PSEUDO_DOMAIN), true, 'suffix of ' + JSON.stringify(name) + ':');
    eq(validEmail(mail), true, 'valid email for ' + JSON.stringify(name) + ':');
  }
});

// ---------------------------------------------------------------------------
// loginEmail
// ---------------------------------------------------------------------------
test('loginEmail: 14 digits become the internal staff address', () => {
  eq(loginEmail('29912121234565'), '29912121234565@staff.invalid');
  eq(loginEmail(' ' + ARABIC_NID + ' '), '29912121234565@staff.invalid');
  eq(loginEmail('2991 2121 234565'), '29912121234565@staff.invalid');
  eq(loginEmail('2991-2121-234565'), '29912121234565@staff.invalid');
});

test('loginEmail: an email is lowercased and trimmed, and stays an email', () => {
  eq(loginEmail('  Sara@Example.COM '), 'sara@example.com');
  eq(loginEmail('ADMIN@LOCAL.TEST'), 'admin@local.test');
  eq(loginEmail('29912121234565@staff.invalid'), '29912121234565@staff.invalid');
});

test('loginEmail: digit counts other than 14 are passed through as typed', () => {
  eq(loginEmail('1234'), '1234');
  eq(loginEmail('2991212123456'), '2991212123456');     // 13 digits
  eq(loginEmail('299121212345678'), '299121212345678'); // 15 digits
  eq(loginEmail(arabic('0012')), '0012');               // digits are still normalised
});

test('loginEmail: a plain name stays a plain name (supervisors log in by name)', () => {
  eq(loginEmail('Ahmed Hassan'), 'Ahmed Hassan');   // only emails are lowercased
  eq(loginEmail('  Ahmed Hassan  '), 'Ahmed Hassan');
  eq(loginEmail('sara'), 'sara');
});

test('loginEmail: empty and non-string identifiers do not throw', () => {
  eq(loginEmail(''), '');
  eq(loginEmail('   '), '');
  eq(loginEmail(null), '');
  eq(loginEmail(undefined), '');
  eq(loginEmail(29912121234565), '29912121234565@staff.invalid');
});

// ---------------------------------------------------------------------------
// maskNationalId
// ---------------------------------------------------------------------------
test('maskNationalId: keeps the last four characters and hides the rest', () => {
  eq(maskNationalId('29912121234565'), BULLET.repeat(10) + '4565');
  eq(maskNationalId('2'.repeat(14)), BULLET.repeat(10) + '2222');
  eq(maskNationalId('123456'), BULLET.repeat(2) + '3456');
  eq(maskNationalId('12345'), BULLET + '2345');
});

test('maskNationalId: four characters or fewer are shown whole (nothing to hide)', () => {
  eq(maskNationalId('1234'), '1234');
  eq(maskNationalId('123'), '123');
  eq(maskNationalId('1'), '1');
});

test('maskNationalId: missing values show an em dash', () => {
  eq(maskNationalId(null), EM_DASH);
  eq(maskNationalId(undefined), EM_DASH);
  eq(maskNationalId(''), EM_DASH);
});

test('maskNationalId: the full 14-digit id never survives masking', () => {
  const masked = maskNationalId('29912121234565');
  eq(masked.length, 14);
  eq(masked.includes('2991212'), false);
  eq(masked.endsWith('4565'), true);
});

// ---------------------------------------------------------------------------
// formatEmployeeCode
// ---------------------------------------------------------------------------
test('formatEmployeeCode: prefixes the number with DC and pads it to six digits', () => {
  eq(formatEmployeeCode('DC', 1), 'DC000001');
  eq(formatEmployeeCode('DC', 123), 'DC000123');
  eq(formatEmployeeCode('DC', 999), 'DC000999');
  eq(formatEmployeeCode('DC', 0), 'DC000000');
});

test('formatEmployeeCode: numbers longer than six digits grow instead of truncating', () => {
  eq(formatEmployeeCode('DC', 1000000), 'DC1000000');
  eq(formatEmployeeCode('DC', 1234567890), 'DC1234567890');
});

test('formatEmployeeCode: a missing prefix falls back to DC, a real prefix is kept', () => {
  eq(formatEmployeeCode('', 7), 'DC000007');
  eq(formatEmployeeCode(null, 7), 'DC000007');
  eq(formatEmployeeCode(undefined, 7), 'DC000007');
  eq(formatEmployeeCode('HR', 7), 'HR000007');
  eq(formatEmployeeCode('ACME-HR', 42), 'ACME-HR000042');
});

test('formatEmployeeCode: string numbers are padded, not re-typed', () => {
  eq(formatEmployeeCode('DC', '42'), 'DC000042');
  eq(formatEmployeeCode('DC', '001234'), 'DC001234');
});

// ---------------------------------------------------------------------------
// validEmail
// ---------------------------------------------------------------------------
test('validEmail: accepts ordinary addresses', () => {
  eq(validEmail('sara@example.com'), true);
  eq(validEmail('  sara@example.com  '), true);   // surrounding spaces are trimmed
  eq(validEmail('first.last+tag@sub.example.co.uk'), true);
  eq(validEmail('a_b-c@mail-server.io'), true);
  eq(validEmail('29912121234565@staff.invalid'), true);
});

test('validEmail: rejects malformed addresses', () => {
  const bad = [
    'sara@', '@example.com', 'sara@example', 'sara.example.com', 'sara@@example.com',
    'sara @example.com', 'sara@exa mple.com', 'plainname',
  ];
  for (const address of bad) eq(validEmail(address), false, JSON.stringify(address) + ':');
});

test('validEmail: empty and non-strings are false, never throw', () => {
  eq(validEmail(''), false);
  eq(validEmail('   '), false);
  eq(validEmail(null), false);
  eq(validEmail(undefined), false);
  eq(validEmail(0), false);
});

// ---------------------------------------------------------------------------
// isEmployeeKind
// ---------------------------------------------------------------------------
test('isEmployeeKind: only kind "employee" counts', () => {
  eq(isEmployeeKind(employeeTitle), true);
  eq(isEmployeeKind(supervisorTitle), false);
  eq(isEmployeeKind(managerTitle), false);
  eq(isEmployeeKind({ id: 'x', kind: 'EMPLOYEE' }), false); // case-sensitive
  eq(isEmployeeKind({ id: 'x' }), false);
  eq(isEmployeeKind(null), false);
  eq(isEmployeeKind(undefined), false);
  eq(isEmployeeKind('employee'), false);                    // a bare string is not a title object
});

// ---------------------------------------------------------------------------
// validateRegistration — positive
// ---------------------------------------------------------------------------
test('validateRegistration: a fully valid employee registration returns null', () => {
  eq(validateRegistration(validRegistration), null);
  eq(validate(), null);
});

test('validateRegistration: an employee needs no email; a non-employee must give one', () => {
  eq(validate({ email: '' }), null);
  eq(validate({ email: '   ' }), null);
  eq(validate({ title: supervisorTitle, email: 'khaled@example.com', managerId: '' }), null);
  eq(validate({ title: managerTitle, email: 'mona@example.com', managerId: '' }), null);
});

test('validateRegistration: an employee may still provide a valid email', () => {
  eq(validate({ email: 'sara@example.com' }), null);
  eq(validate({ email: ' sara@example.com ' }), null);
});

test('validateRegistration: no manager is required when nobody can be chosen yet', () => {
  eq(validate({ managerId: '', supervisorCount: 0 }), null);
  eq(validate({ managerId: undefined, supervisorCount: 0 }), null);
  eq(validate({ managerId: '', supervisorCount: undefined }), null); // supervisorCount defaults to 0
});

test('validateRegistration: names with extra spacing are accepted', () => {
  eq(validate({ fullName: '  Sara   Ahmed ' }), null);
  eq(validate({ fullName: 'Ahmed Hassan' }), null);
  eq(validate({ fullName: 'Ahmed Mohamed Ali Hassan' }), null);
  eq(validate({ fullName: 'A B' }), null);          // two one-letter words is still two words
  eq(validate({ fullName: ARABIC_FULL_NAME }), null);
});

test('validateRegistration: an Arabic national id is accepted', () => {
  eq(validate({ nationalId: ARABIC_NID }), null);
  eq(validate({ nationalId: ARABIC_SPACED }), null);
  eq(validate({ nationalId: PERSIAN_NID }), null);
});

// ---------------------------------------------------------------------------
// validateRegistration — negative, one rule per test
// ---------------------------------------------------------------------------
test('validateRegistration: requires a job title, and checks it first', () => {
  const msg = 'اختر المسمى الوظيفي.';
  eq(validate({ title: null }), msg);
  eq(validate({ title: undefined }), msg);
  eq(validateRegistration({}), msg);
  // Everything else is wrong too, yet the title message wins.
  eq(validate({ title: null, fullName: '', nationalId: 'x', password: '1', confirm: '2' }), msg);
});

test('validateRegistration: the full name needs at least two words', () => {
  const msg = 'أدخل اسمك كاملًا كما هو مسجل في الرقم القومي.';
  eq(validate({ fullName: 'Sara' }), msg);
  eq(validate({ fullName: '   ' }), msg);
  eq(validate({ fullName: 'Sara   ' }), msg);   // padding does not create a second word
  eq(validate({ fullName: '' }), msg);
  eq(validate({ fullName: null }), msg);
  eq(validate({ fullName: undefined }), msg);
});

test('validateRegistration: the name is checked before the national id', () => {
  eq(validate({ fullName: 'Sara', nationalId: 'nope' }),
    'أدخل اسمك كاملًا كما هو مسجل في الرقم القومي.');
});

test('validateRegistration: an invalid or missing national id is rejected', () => {
  const msg = 'يجب أن يتكون الرقم القومي من 14 رقمًا صحيحًا، وأن يبدأ بالرقم 2 أو 3 ويتضمن تاريخ ميلاد صحيحًا.';
  eq(validate({ nationalId: '' }), msg);
  eq(validate({ nationalId: '29913011234567' }), msg);   // month 13
  eq(validate({ nationalId: '2991212123456' }), msg);    // 13 digits
  eq(validate({ nationalId: '19912121234565' }), msg);   // wrong century
  eq(validate({ nationalId: null }), msg);
  eq(validate({ nationalId: undefined }), msg);
});

test('validateRegistration: the national id is checked before the email rule', () => {
  eq(validate({ title: supervisorTitle, email: '', nationalId: '1' }).startsWith('يجب أن يتكون'), true);
});

test('validateRegistration: non-employee titles must supply an email', () => {
  const msg = 'البريد الإلكتروني مطلوب لهذا المسمى الوظيفي.';
  eq(validate({ title: supervisorTitle, email: '' }), msg);
  eq(validate({ title: supervisorTitle, email: '   ' }), msg);
  eq(validate({ title: managerTitle, email: undefined }), msg);
});

test('validateRegistration: a supplied email must look like an email, for every title', () => {
  const msg = 'عنوان البريد الإلكتروني غير صالح.';
  eq(validate({ email: 'sara@' }), msg);
  eq(validate({ email: 'not-an-email' }), msg);
  eq(validate({ email: '@example.com' }), msg);
  eq(validate({ title: supervisorTitle, email: 'khaled@' }), msg);
  eq(validate({ title: managerTitle, email: 'mona example.com' }), msg);
});

test('validateRegistration: an employee needs a manager only when supervisors exist', () => {
  const msg = 'اختر المشرف المباشر.';
  eq(validate({ managerId: '' }), msg);
  eq(validate({ managerId: null }), msg);
  eq(validate({ managerId: undefined }), msg);
  eq(validate({ managerId: '', supervisorCount: 3 }), msg);
});

test('validateRegistration: non-employees are never asked for a manager', () => {
  eq(validate({ title: supervisorTitle, email: 'khaled@example.com', managerId: '', supervisorCount: 2 }), null);
  eq(validate({ title: managerTitle, email: 'mona@example.com', managerId: undefined, supervisorCount: 5 }), null);
});

test('validateRegistration: the password must be at least six characters', () => {
  const msg = 'يجب ألا تقل كلمة المرور عن 6 أحرف.';
  eq(validate({ password: '', confirm: '' }), msg);
  eq(validate({ password: '12345', confirm: '12345' }), msg);
  eq(validate({ password: null, confirm: null }), msg);
  eq(validate({ password: undefined, confirm: undefined }), msg);
  eq(validate({ password: '123456', confirm: '123456' }), null); // exactly six is fine
  eq(validate({ password: '      ', confirm: '      ' }), null); // six spaces count as six characters
});

test('validateRegistration: the password confirmation must match exactly', () => {
  const msg = 'كلمتا المرور غير متطابقتين.';
  eq(validate({ confirm: 'different' }), msg);
  eq(validate({ confirm: 'Secret1' }), msg);      // case matters
  eq(validate({ confirm: 'secret1 ' }), msg);     // no trimming
  eq(validate({ confirm: undefined }), msg);
});

test('validateRegistration: rules run in order — earlier failures win', () => {
  // Bad password plus a missing manager: the manager message comes first.
  eq(validate({ managerId: '', password: '1', confirm: '2' }), 'اختر المشرف المباشر.');
  // Good manager, bad national id: the national id message comes first.
  eq(validate({ nationalId: '', password: '1', confirm: '2' }).startsWith('يجب أن يتكون'), true);
});

test('validateRegistration: an empty or partial call never throws', () => {
  eq(validateRegistration({}), 'اختر المسمى الوظيفي.');
  eq(typeof validateRegistration({ title: supervisorTitle }), 'string');
  eq(typeof validateRegistration({ title: employeeTitle }), 'string');
});

test('validateRegistration: does not mutate the payload it receives', () => {
  const payload = { ...validRegistration };
  const before = JSON.stringify(payload);
  validateRegistration({ ...validRegistration, nationalId: 'bad' });
  eq(JSON.stringify(payload), before);
  eq(payload, validRegistration);
});
