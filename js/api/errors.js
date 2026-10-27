import { getLang } from '../lib/i18n.js';

const MESSAGES = {
  ar: {
    not_active: 'لم يُفعّل حسابك بعد. يُرجى التواصل مع إدارة الموارد البشرية.',
    no_location: 'لم يُحدّد لك فرع عمل بعد. يُرجى التواصل مع إدارة الموارد البشرية.',
    shift_not_open: 'هذه الوردية غير متاحة للتسجيل حاليًا. اختر وردية مفتوحة.',
    bad_shift: 'اختر الوردية أولًا.',
    needs_migration: 'يلزم تطبيق ترقية قاعدة البيانات من مجلد supabase/migrations قبل استخدام هذه الميزة.',
    low_accuracy: 'دقة موقع GPS منخفضة. انتقل إلى مكان مفتوح وحاول مجددًا.',
    out_of_range: 'أنت خارج نطاق موقع العمل.',
    already_checked_in: 'سجّلت حضورك اليوم بالفعل.',
    already_checked_out: 'سجّلت انصرافك اليوم بالفعل.',
    not_checked_in: 'يجب تسجيل الحضور أولًا.',
    run_locked: 'أُقفل مسير الرواتب لهذا الشهر، ولا يمكن تعديله.',
    gps_denied: 'يرجى السماح للمتصفح بالوصول إلى موقعك.',
    gps_unavailable: 'تعذّر تحديد موقعك. تأكد من تفعيل GPS.',
    no_geolocation: 'متصفحك لا يدعم تحديد الموقع الجغرافي.',
    bad_credentials: 'بيانات الدخول غير صحيحة. تحقق من الاسم أو الرقم القومي أو البريد الإلكتروني، ومن كلمة المرور.',
    email_unconfirmed: 'يرجى تأكيد بريدك الإلكتروني من رسالة التأكيد.',
    already_registered: 'هذا البريد الإلكتروني أو الرقم القومي مسجل بالفعل.',
    invalid_national_id: 'الرقم القومي غير صحيح.',
    signup_failed: 'تعذّر إنشاء الحساب. تحقق من البيانات، أو تأكد من عدم تسجيل الرقم القومي مسبقًا.',
    signup_role_forbidden: 'التسجيل الذاتي متاح لحسابات الموظفين فقط.',
    bad_email: 'عنوان البريد الإلكتروني غير صالح، أو لم يقبله Supabase.',
    weak_password: 'كلمة المرور ضعيفة. يجب ألا تقل عن 6 أحرف.',
    forbidden: 'ليست لديك صلاحية تنفيذ هذا الإجراء.',
    self_edit: 'لا يمكنك تعديل سجل حضورك. يُرجى طلب المساعدة من إدارة الموارد البشرية أو مدير النظام.',
    month_locked: 'اعتُمدت رواتب هذا الشهر وأُقفلت. يقتصر التعديل على إدارة الموارد البشرية أو مدير النظام.',
    reason_required: 'أدخل سببًا جديدًا لكل تعديل.',
    forbidden_status: 'يلزم امتلاك صلاحية خاصة لتغيير حالة الحضور.',
    role_forbidden: 'يقتصر تعيين الأدوار الإدارية وتعديل حسابات مديري النظام على مدير النظام.',
    self_archive: 'لا يمكنك حذف حسابك أنت.',
    verification_not_pending: 'لم يعد سجل الحضور بانتظار المراجعة.',
    invalid_decision: 'قرار مراجعة الحضور غير صالح.',
    duplicate: 'هذه القيمة مسجلة بالفعل.',
    in_use: 'لا يمكن حذف هذا العنصر لأنه مستخدم في بيانات أخرى.',
    rate_limited: 'بلغت حد محاولات Supabase المسموح بها. انتظر قليلًا قبل إعادة المحاولة.',
    server_error: 'حدث خطأ في الخادم. حاول مرة أخرى.',
  },
  en: {
    not_active: 'Your account is not active yet. Contact HR.',
    no_location: 'No work location is assigned to you yet. Contact HR.',
    shift_not_open: 'This shift is not open for clock-in. Choose an open shift.',
    bad_shift: 'Select a shift first.',
    needs_migration: 'Apply the database upgrade in supabase/migrations before using this feature.',
    low_accuracy: 'GPS accuracy is too low. Move to an open area and try again.',
    out_of_range: 'You are outside the work location boundary.',
    already_checked_in: 'You have already clocked in for this workday.',
    already_checked_out: 'You have already clocked out.',
    not_checked_in: 'Clock in before clocking out.',
    run_locked: 'This payroll run is locked and cannot be changed.',
    gps_denied: 'Allow the browser to access your location.',
    gps_unavailable: 'Your location could not be determined. Check that GPS is enabled.',
    no_geolocation: 'Your browser does not support location services.',
    bad_credentials: 'The sign-in details are incorrect. Check the name, national ID or email, and the password.',
    email_unconfirmed: 'Confirm your email using the confirmation message.',
    already_registered: 'This email address or national ID is already registered.',
    invalid_national_id: 'The national ID is invalid.',
    signup_failed: 'Unable to create the account. Check the details and make sure the national ID is not already registered.',
    signup_role_forbidden: 'Self-registration is available for employee accounts only.',
    bad_email: 'The email address is invalid or was rejected by Supabase.',
    weak_password: 'The password must be at least 6 characters long.',
    forbidden: 'You do not have permission to perform this action.',
    self_edit: 'You cannot edit your own attendance record. Contact HR or the system administrator.',
    month_locked: 'This month’s payroll is approved and locked. Only HR or the system administrator may edit it.',
    reason_required: 'Enter a new reason for each change.',
    forbidden_status: 'You need special permission to change the attendance status.',
    role_forbidden: 'Only the system administrator can assign administrative roles or edit administrator accounts.',
    self_archive: 'You cannot delete your own account.',
    verification_not_pending: 'This attendance record is no longer awaiting review.',
    invalid_decision: 'The attendance review decision is invalid.',
    duplicate: 'This value is already in use.',
    in_use: 'This item cannot be deleted because other records use it.',
    rate_limited: 'The Supabase request limit was reached. Wait a little before trying again.',
    server_error: 'A server error occurred. Try again.',
  },
};

export function codedError(code, detail) {
  return Object.assign(new Error(detail || code), { code, detail });
}

// Refusals and server errors from the account service come with the reason ("no_token", "not_admin", ...), shown in
// brackets so they can be traced; everything else is just the message for its code.
const SHOW_DETAIL = new Set(['forbidden', 'server_error']);

export function errorText(err) {
  const messages = MESSAGES[getLang()] || MESSAGES.en;
  const base = messages[err?.code];
  if (!base) return err?.message || messages.server_error;
  return err.detail && SHOW_DETAIL.has(err.code) ? `${base} [${err.detail}]` : base;
}
