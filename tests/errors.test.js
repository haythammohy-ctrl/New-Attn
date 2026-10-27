import { test, eq } from './harness.js';
import { codedError, errorText } from '../js/api/errors.js';
import { getLang, setLang } from '../js/lib/i18n.js';

const original = getLang();   // the tests switch the language; put it back afterwards

test('errors: a refusal from the account service shows why, in brackets', () => {
  setLang('en');
  eq(errorText(codedError('forbidden')), 'You do not have permission to perform this action.');
  eq(errorText(codedError('forbidden', 'not_admin')), 'You do not have permission to perform this action. [not_admin]');
  eq(errorText(codedError('server_error', 'boom')).endsWith('[boom]'), true);
});

test('errors: other codes ignore the detail, and unknown codes show their own message', () => {
  setLang('en');
  eq(errorText(codedError('weak_password', 'x')).includes('['), false);
  eq(errorText(codedError('nope', 'Something odd')), 'Something odd');
  eq(errorText(new Error('plain')), 'plain');
  eq(errorText(undefined), errorText(codedError('server_error')));
});

test('errors: the Arabic text carries the reason too', () => {
  setLang('ar');
  eq(errorText(codedError('forbidden', 'no_token')), 'ليست لديك صلاحية تنفيذ هذا الإجراء. [no_token]');
  setLang(original);
});
