// Sign-up rules shared by the registration form, the demo backend and the tests.
// The database checks the national id and numbers the employees itself.

export const PSEUDO_DOMAIN = 'staff.invalid';

// Arabic-Indic and Persian digits become ordinary ASCII digits
export function toAsciiDigits(value) {
  return String(value ?? '')
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

export const cleanNationalId = (value) => toAsciiDigits(value).replace(/[\s-]/g, '');

// 14 digits, first digit 2 (1900s) or 3 (2000s), then a real birth date YYMMDD.
export function validNationalId(value) {
  const nid = cleanNationalId(value);
  if (!/^[23]\d{13}$/.test(nid)) return false;
  const year = (nid[0] === '2' ? 1900 : 2000) + Number(nid.slice(1, 3));
  const month = Number(nid.slice(3, 5));
  const day = Number(nid.slice(5, 7));
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export const pseudoEmail = (nationalId) => `${cleanNationalId(nationalId)}@${PSEUDO_DOMAIN}`;
export const isPseudoEmail = (email) => String(email || '').toLowerCase().endsWith(`@${PSEUDO_DOMAIN}`);

// Converts a user's full name into a deterministic safe internal email
// e.g. "Ahmed Hassan" -> "ahmed.hassan@staff.invalid"
export function nameToPseudoEmail(name) {
  const clean = String(name || '').trim().toLowerCase()
    .replace(/\s+/g, '.')
    .replace(/[^a-z0-9\._-]/g, '');
  return `${clean || 'user'}@${PSEUDO_DOMAIN}`;
}

// What the login box accepts:
// 1. A 14-digit national ID (for Employee) -> [nid]@staff.invalid
// 2. An email address -> normalized email
// 3. A staff member's Name (for Manager, Supervisor, Admin) -> name or pseudoEmail
export function loginEmail(identifier) {
  const typed = toAsciiDigits(identifier).trim();
  const digits = typed.replace(/[\s-]/g, '');
  if (/^\d{14}$/.test(digits)) {
    return pseudoEmail(digits);
  }
  if (typed.includes('@')) {
    return typed.toLowerCase();
  }
  return typed;
}

// Shows only the last four digits, for lists.
export const maskNationalId = (nid) => (nid ? `${'•'.repeat(Math.max(0, nid.length - 4))}${nid.slice(-4)}` : '—');

export function formatEmployeeCode(prefix, n) {
  const digits = String(n);
  return `${prefix || 'DC'}${digits.padStart(Math.max(6, digits.length), '0')}`;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const validEmail = (value) => EMAIL.test(String(value || '').trim());

// A job title of kind 'employee' is a regular employee; any other kind is supervision or management.
export const isEmployeeKind = (title) => title?.kind === 'employee';

// Returns problem message or null if valid (preserves compatibility with registration unit tests)
export function validateRegistration({
  title, fullName, nationalId, email, managerId, supervisorCount = 0, password, confirm,
}) {
  if (!title) return 'اختر المسمى الوظيفي.';
  const words = String(fullName || '').trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) return 'أدخل اسمك كاملًا كما هو مسجل في الرقم القومي.';
  if (!validNationalId(nationalId)) return 'يجب أن يتكون الرقم القومي من 14 رقمًا صحيحًا، وأن يبدأ بالرقم 2 أو 3 ويتضمن تاريخ ميلاد صحيحًا.';
  const mail = String(email || '').trim();
  if (!isEmployeeKind(title) && !mail) return 'البريد الإلكتروني مطلوب لهذا المسمى الوظيفي.';
  if (mail && !validEmail(mail)) return 'عنوان البريد الإلكتروني غير صالح.';
  // With nobody to choose from yet, the manager can be set later by HR.
  if (isEmployeeKind(title) && supervisorCount > 0 && !managerId) return 'اختر المشرف المباشر.';
  if (String(password || '').length < 6) return 'يجب ألا تقل كلمة المرور عن 6 أحرف.';
  if (password !== confirm) return 'كلمتا المرور غير متطابقتين.';
  return null;
}
