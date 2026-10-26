import { test, eq } from './harness.js';
import {
  cleanNationalId, formatEmployeeCode, isPseudoEmail, loginEmail, maskNationalId, pseudoEmail, toAsciiDigits,
  validNationalId, validateRegistration,
} from '../js/lib/registration.js';

const employee = { id: 'e', name: 'موظف', kind: 'employee' };
const supervisor = { id: 's', name: 'سوبر فيزر', kind: 'supervision' };
const good = {
  title: employee, fullName: 'سارة أحمد محمود', nationalId: '29912121234565', email: '',
  managerId: 'm1', supervisorCount: 2, password: 'secret1', confirm: 'secret1',
};
const problem = (changes) => validateRegistration({ ...good, ...changes });

test('national id: 14 digits, century digit 2 or 3, a real birth date', () => {
  eq(validNationalId('29912121234565'), true);     // 1999-12-12
  eq(validNationalId('30001011234567'), true);     // 2000-01-01
  eq(validNationalId('30002291234567'), true);     // 2000 is a leap year
  eq(validNationalId('29002291234567'), false);    // 1990-02-29 does not exist
  eq(validNationalId('20002291234567'), false);    // 1900 is not a leap year
  eq(validNationalId('29913011234567'), false);    // month 13
  eq(validNationalId('29901321234567'), false);    // day 32
  eq(validNationalId('19901011234567'), false);    // first digit 1
  eq(validNationalId('49901011234567'), false);    // first digit 4
  eq(validNationalId('2991212123456'), false);     // 13 digits
  eq(validNationalId('299121212345678'), false);   // 15 digits
  eq(validNationalId('2991212123456a'), false);
  eq(validNationalId(''), false);
  eq(validNationalId(null), false);
});

test('national id accepts Arabic digits, spaces and dashes', () => {
  eq(toAsciiDigits('٢٩٩١٢١٢'), '2991212');
  eq(toAsciiDigits('۲۹۹۱۲۱۲'), '2991212');
  eq(cleanNationalId('2991 2121-234565'), '29912121234565');
  eq(validNationalId('٢٩٩١٢١٢١٢٣٤٥٦٥'), true);
  eq(validNationalId('2 9912 12 1234565'), true);
});

test('login: an email stays an email, 14 digits become the internal address', () => {
  eq(loginEmail('29912121234565'), '29912121234565@staff.invalid');
  eq(loginEmail(' ٢٩٩١٢١٢١٢٣٤٥٦٥ '), '29912121234565@staff.invalid');
  eq(loginEmail('2991 2121 234565'), '29912121234565@staff.invalid');
  eq(loginEmail('  Sara@Example.COM '), 'sara@example.com');
  eq(loginEmail('1234'), '1234');                    // not a national id: passed on as typed
  eq(pseudoEmail('2991 2121 234565'), '29912121234565@staff.invalid');
  eq(isPseudoEmail('29912121234565@staff.invalid'), true);
  eq(isPseudoEmail('sara@example.com'), false);
});

test('national id is shown masked in lists', () => {
  eq(maskNationalId('29912121234565'), '••••••••••4565');
  eq(maskNationalId(null), '—');
  eq(maskNationalId(''), '—');
});

test('employee numbers: prefix + six digits, growing past six', () => {
  eq(formatEmployeeCode('DC', 1), 'DC000001');
  eq(formatEmployeeCode('DC', 123), 'DC000123');
  eq(formatEmployeeCode('DC', 999999), 'DC999999');
  eq(formatEmployeeCode('DC', 1000000), 'DC1000000');
  eq(formatEmployeeCode('', 7), 'DC000007');
  eq(formatEmployeeCode('HR', 7), 'HR000007');
});

test('registration: an employee needs no email, but does need a manager and a valid national id', () => {
  eq(problem({}), null);
  eq(typeof problem({ managerId: '' }), 'string');
  eq(problem({ managerId: '', supervisorCount: 0 }), null);          // nobody to choose from yet
  eq(typeof problem({ nationalId: '29913011234567' }), 'string');
  eq(typeof problem({ nationalId: '' }), 'string');
  eq(typeof problem({ title: null }), 'string');
});

test('registration: any other job title needs a real email, and no manager', () => {
  eq(typeof problem({ title: supervisor, email: '' }), 'string');
  eq(problem({ title: supervisor, email: 'khaled@example.com', managerId: '' }), null);
  eq(typeof problem({ title: supervisor, email: 'not-an-email' }), 'string');
});

test('registration: an email an employee does type must still look like an email', () => {
  eq(problem({ email: 'sara@example.com' }), null);
  eq(typeof problem({ email: 'sara@' }), 'string');
});

test('registration: full name, password length and confirmation', () => {
  eq(typeof problem({ fullName: 'سارة' }), 'string');
  eq(typeof problem({ fullName: '   ' }), 'string');
  eq(problem({ fullName: '  سارة   أحمد ' }), null);
  eq(typeof problem({ password: '12345', confirm: '12345' }), 'string');
  eq(typeof problem({ confirm: 'different' }), 'string');
});
