// Bilingual interface text in Arabic and English.

const translations = {
  ar: {
    // Brand & Header
    appName: 'الحضور والرواتب - طلبات مارت',
    companyDefault: 'طلبات مارت',

    // Roles. The chain of responsibility, highest first:
    //   admin > manager > assistant_manager > supervisor > employee
    roles: {
      employee: 'موظف',
      supervisor: 'مشرف',
      assistant_manager: 'مساعد مدير',
      manager: 'مدير',
      admin: 'مدير النظام',
    },
    rolesDesc: {
      employee: 'تسجيل الحضور وتقديم طلبات الإجازة',
      supervisor: 'يشرف على فريق واحد يحدده مدير النظام: متابعة الحضور واعتماد طلبات الإجازة',
      assistant_manager: 'يشرف على عدة فرق يحددها مدير النظام، ويتابع الموظفين والعمليات والرواتب',
      manager: 'أعلى من مساعد المدير: يتابع ويطلع على كل شيء دون تعديل',
      admin: 'إدارة النظام والتحكم الكامل فيه',
    },

    // Navigation
    nav: {
      home: 'تسجيل الحضور',
      dashboard: 'لوحة المعلومات',
      history: 'سجل الحضور',
      leave: 'طلب إجازة',
      payslips: 'قسائم الرواتب',
      approvals: 'الموافقات',
      records: 'سجلات الحضور',
      employees: 'الموظفون',
      teams: 'فرق العمل',
      payroll: 'مسيرات الرواتب',
      setup: 'الإعدادات',
      permissions: 'الصلاحيات',
      me: 'الملف الشخصي',
    },

    // Topbar & System Actions
    topbar: {
      logout: 'تسجيل الخروج',
      toggleTheme: 'تبديل المظهر',
      toggleLang: 'English',
      demoReset: 'إعادة ضبط البيانات التجريبية',
      demoWarning: 'سيتم حذف جميع البيانات التجريبية المحفوظة في هذا المتصفح. هل تريد المتابعة؟',
      demoConfirmBtn: 'مسح البيانات',
      demoBanner: 'الوضع التجريبي: تُحفظ البيانات محليًا في هذا المتصفح فقط.',
      backupBannerStale: 'مرّ {days} يومًا على آخر نسخة احتياطية.',
      backupBannerNone: 'لم يتم إنشاء أي نسخة احتياطية بعد.',
      backupLink: 'الإعدادات ← النسخ الاحتياطي',
      migrationBanner: 'يلزم ترقية قاعدة البيانات لتحديث الصلاحيات والفرق.',
    },

    // Common Buttons & Labels
    common: {
      save: 'حفظ',
      cancel: 'إلغاء',
      delete: 'حذف',
      edit: 'تعديل',
      add: 'إضافة',
      search: 'بحث',
      filter: 'تصفية',
      all: 'الكل',
      none: '— بدون —',
      active: 'نشط',
      inactive: 'غير نشط',
      status: 'الحالة',
      name: 'الاسم',
      email: 'البريد الإلكتروني',
      role: 'الدور',
      jobTitle: 'المسمى الوظيفي',
      team: 'الفريق',
      branch: 'الفرع',
      password: 'كلمة المرور',
      confirmPassword: 'تأكيد كلمة المرور',
      loading: 'جارٍ التحميل...',
      noData: 'لا توجد بيانات متاحة',
      done: 'تم',
      copy: 'نسخ',
      copied: 'تم النسخ بنجاح',
      from: 'من',
      to: 'إلى',
      days: 'الأيام',
      reason: 'السبب',
      optional: 'اختياري',
      required: 'مطلوب',
    },

    // Login Page
    login: {
      title: 'تسجيل الدخول',
      demoTitle: 'نظام الحضور والرواتب',
      demoSubtitle: 'الوضع التجريبي: اختر حسابًا لتسجيل الدخول.',
      usernameLabel: 'اسم المستخدم أو الرقم القومي',
      usernamePlaceholder: 'الاسم (للمدير أو المشرف) أو الرقم القومي (للموظف)',
      usernameHint: 'يسجّل المدير والمشرف باستخدام الاسم، بينما يستخدم الموظف الرقم القومي المكوّن من 14 رقمًا.',
      passwordLabel: 'كلمة المرور',
      passwordPlaceholder: '••••••••',
      submitBtn: 'تسجيل الدخول',
      newUserBtn: 'مستخدم جديد؟ أنشئ حسابًا',
      fillAllFields: 'يرجى إدخال اسم المستخدم وكلمة المرور.',
      createDemoAccount: 'إنشاء حساب جديد (تجريبي)',
    },

    // Leave Page
    leave: {
      title: 'طلب إجازة',
      categories: {
        paid_leave: 'إجازة مدفوعة الأجر',
        unpaid_leave: 'إجازة غير مدفوعة الأجر',
        day_off: 'يوم راحة',
        public_holiday: 'عطلة رسمية',
        absence: 'غياب',
        excused_absence: 'غياب بعذر',
      },
      myRequests: 'طلباتي السابقة',
      remainingDays: 'يوم متبقٍ',
      type: 'نوع الإجازة',
      fromDate: 'تاريخ البدء',
      toDate: 'تاريخ الانتهاء',
      reasonPlaceholder: 'اكتب سبب الإجازة (اختياري)...',
      submitBtn: 'إرسال طلب الإجازة',
      cancelRequest: 'إلغاء الطلب',
      cancelConfirm: 'هل أنت متأكد من رغبتك في إلغاء هذا الطلب؟',
      checkDatesError: 'يرجى التحقق من تاريخَي الإجازة.',
      allHolidaysError: 'تقع الفترة المحددة بالكامل ضمن أيام الراحة الأسبوعية أو العطلات الرسمية.',
      sentSuccess: 'أُرسل طلب الإجازة إلى الإدارة للمراجعة.',
      emptyRequests: 'لا توجد طلبات إجازة مسجلة.',
      statuses: {
        pending: 'قيد المراجعة',
        approved: 'معتمدة',
        rejected: 'مرفوضة',
      },
    },

    // Payslips Page
    payslips: {
      currentMonthTitle: 'مستحقات شهر {month}',
      runningNotice: 'تُحدّث هذه القسيمة تلقائيًا بعد كل وردية مسجلة حتى اليوم، وتصبح نهائية بعد اعتماد إقفال الشهر.',
      updatedBadge: 'تُحدّث بعد كل وردية',
      completedDays: 'أيام العمل المكتملة',
      absenceDays: 'أيام الغياب',
      pendingReviews: 'حضور بانتظار مراجعة المشرف',
      overtime: 'العمل الإضافي',
      delaysAndEarly: 'التأخير والانصراف المبكر',
      estimatedNet: 'صافي المستحقات التقديري حتى اليوم',
      finalNotice: 'تُحتسب جميع البدلات والاستقطاعات عند اعتماد مسير الرواتب الشهري.',
      viewDetails: 'عرض تفاصيل المستحقات',
      archivedSlips: 'كشوف الرواتب المعتمدة السابقة',
      archivedDesc: 'كشوف الأشهر السابقة بعد إقفالها واعتمادها من إدارتي الموارد البشرية والمالية.',
      noArchivedSlips: 'لا توجد كشوف رواتب معتمدة حتى الآن.',
      viewOfficialSlip: 'عرض كشف الراتب المعتمد',
      month: 'الشهر',
      baseSalary: 'الراتب الأساسي',
      netSalary: 'صافي الراتب',
      allowances: 'البدلات',
      deductions: 'الاستقطاعات',
    },

    // Approvals Page
    approvals: {
      title: 'الموافقات ومراجعة السجلات',
      subtitle: 'راجع طلبات الإجازة واعتمدها، وصحّح سجلات الحضور والانصراف غير المكتملة.',
      tabLeaves: 'طلبات الإجازات',
      tabAttendance: 'مراجعة الحضور والانصراف',
      tabAudit: 'سجل التدقيق',
      pendingLeavesTitle: 'طلبات الإجازة بانتظار الاعتماد',
      pastLeavesTitle: 'سجل الإجازات السابقة',
      approveBtn: 'موافقة',
      rejectBtn: 'رفض',
      confirmApprovePrompt: 'هل تريد اعتماد طلب الإجازة المقدم من {name}؟',
      confirmRejectPrompt: 'هل تريد رفض طلب الإجازة المقدم من {name}؟',
      approvedSuccess: 'اعتُمد طلب الإجازة.',
      rejectedSuccess: 'رُفض طلب الإجازة.',
      attentionRequiredTitle: 'سجلات حضور تحتاج إلى مراجعة',
      attentionSubtitle: 'راجع إثباتات الحضور المعلقة، ثم راجع سجلات الانصراف والتأخير وصححها عند الحاجة.',
      noAttentionNeeded: 'لا توجد سجلات حضور غير مكتملة أو حالات تأخير تحتاج إلى مراجعة.',
      verificationPending: 'بانتظار تأكيد المشرف',
      verificationApproved: 'تم تأكيد الحضور',
      verificationRejected: 'رُفض إثبات الحضور',
      confirmAttendanceBtn: 'تأكيد الحضور',
      attendanceConfirmed: 'تم تأكيد الحضور.',
      attendanceConfirmedAudit: 'تأكيد الحضور',
      attendanceRejectedAudit: 'رفض الحضور',
      reviewTitle: 'مراجعة حضور: {name}',
      reviewNote: 'سبب الرفض (مطلوب)',
      verificationSaved: 'تم حفظ قرار مراجعة الحضور.',
      verificationFailed: 'تعذر حفظ قرار مراجعة الحضور.',
      auditAction: 'الإجراء',
      correctBtn: 'تصحيح السجل',
      modalCorrectTitle: 'تصحيح سجل حضور: {name}',
      correctionReasonRequired: 'يجب إدخال سبب التصحيح لحفظ التعديل.',
      correctionSaved: 'حُفظ تصحيح سجل الحضور ووُثّق.',
      auditTitle: 'سجل التدقيق',
      noAuditRecords: 'لا توجد سجلات تدقيق.',
    },

    // Employees Page & Creation
    employees: {
      title: 'إدارة الموظفين',
      createUserBtn: '+ إنشاء حساب مستخدم',
      createStaffTitle: 'إنشاء حساب إداري',
      createStaffSubtitle: 'أنشئ حسابًا لمدير الموارد البشرية أو مشرف الفريق باستخدام الاسم وكلمة المرور؛ لا يلزم إدخال الرقم القومي.',
      createEmployeeTitle: 'إنشاء حساب موظف',
      createEmployeeSubtitle: 'أنشئ حساب موظف باستخدام الاسم والرقم القومي وكلمة المرور. ويُستخدم الرقم القومي اسمًا لتسجيل الدخول.',
      selectRolePrompt: 'اختر دور الحساب الذي تريد إنشاءه:',
      pendingTitle: 'طلبات تسجيل جديدة قيد المراجعة',
      pendingSubtitle: 'راجع بيانات الموظفين، ثم فعّل حساباتهم وحدد الفريق والفرع والراتب.',
      empty: 'لا يوجد موظفون مسجلون حاليًا.',
      reviewAndActivate: 'مراجعة وتفعيل',
      resetPassword: 'إعادة تعيين كلمة المرور',
      credentialsTitle: 'بيانات دخول {label}',
      credentialsNotice: 'انسخ اسم المستخدم وكلمة المرور وشارِكهما مع المستخدم ليتمكن من تسجيل الدخول:',
      usernameIs: 'اسم المستخدم:',
      passwordIs: 'كلمة المرور:',
    },
  },

  en: {
    // Brand & Header
    appName: 'Talabat Mart Attendance & Payroll',
    companyDefault: 'Talabat Mart',

    // Roles. The chain of responsibility, highest first:
    //   admin > manager > assistant_manager > supervisor > employee
    roles: {
      employee: 'Employee',
      supervisor: 'Supervisor',
      assistant_manager: 'Assistant Manager',
      manager: 'Manager',
      admin: 'System Administrator',
    },
    rolesDesc: {
      employee: 'Clock in/out and submit leave requests',
      supervisor: 'Runs one team picked by the admin: attendance and leave approvals',
      assistant_manager: 'Runs several teams picked by the admin: staff, operations, and payroll',
      manager: 'Above the assistant manager: oversees and reports, without editing anything',
      admin: 'Full system control and configuration',
    },

    // Navigation
    nav: {
      home: 'Clock In',
      dashboard: 'Dashboard',
      history: 'My History',
      leave: 'Leave Request',
      payslips: 'My Payslips',
      approvals: 'Approvals',
      records: 'Attendance Records',
      employees: 'Employees',
      teams: 'Teams',
      payroll: 'Payroll Runs',
      setup: 'Settings',
      permissions: 'Permissions',
      me: 'My Profile',
    },

    // Topbar & System Actions
    topbar: {
      logout: 'Sign Out',
      toggleTheme: 'Toggle Theme',
      toggleLang: 'العربية',
      demoReset: 'Reset Demo Data',
      demoWarning: 'All local demo data will be permanently cleared. Proceed?',
      demoConfirmBtn: 'Clear Data',
      demoBanner: 'Demo mode: data stored locally in this browser only.',
      backupBannerStale: 'Last backup: {days} days ago.',
      backupBannerNone: 'No backup has been taken yet.',
      backupLink: 'Settings → Backup',
      migrationBanner: 'The database must be upgraded to update permissions and teams.',
    },

    // Common Buttons & Labels
    common: {
      save: 'Save',
      cancel: 'Cancel',
      delete: 'Delete',
      edit: 'Edit',
      add: 'Add',
      search: 'Search',
      filter: 'Filter',
      all: 'All',
      none: '— None —',
      active: 'Active',
      inactive: 'Inactive',
      status: 'Status',
      name: 'Name',
      email: 'Email',
      role: 'Role',
      jobTitle: 'Job title',
      team: 'Team',
      branch: 'Branch',
      password: 'Password',
      confirmPassword: 'Confirm Password',
      loading: 'Loading...',
      noData: 'No records available',
      done: 'Done',
      copy: 'Copy',
      copied: 'Copied to clipboard',
      from: 'From',
      to: 'To',
      days: 'Days',
      reason: 'Reason',
      optional: 'Optional',
      required: 'Required',
    },

    // Login Page
    login: {
      title: 'Sign In',
      demoTitle: 'Attendance & Payroll System',
      demoSubtitle: 'Demo mode: Select an account to sign in.',
      usernameLabel: 'Username or National ID',
      usernamePlaceholder: 'Name (manager or supervisor) or national ID (employee)',
      usernameHint: 'Managers and supervisors sign in with their name; employees use their national ID (14 digits).',
      passwordLabel: 'Password',
      passwordPlaceholder: '••••••••',
      submitBtn: 'Sign In',
      newUserBtn: 'New user? Create an account',
      fillAllFields: 'Please enter both username and password',
      createDemoAccount: 'Create New Account (Demo)',
    },

    // Leave Page
    leave: {
      title: 'Leave Request',
      categories: {
        paid_leave: 'Paid leave',
        unpaid_leave: 'Unpaid leave',
        day_off: 'Day off',
        public_holiday: 'Public holiday',
        absence: 'Absence',
        excused_absence: 'Excused absence',
      },
      myRequests: 'My Requests',
      remainingDays: 'days remaining',
      type: 'Leave Type',
      fromDate: 'Start Date',
      toDate: 'End Date',
      reasonPlaceholder: 'Enter reason for leave (optional)...',
      submitBtn: 'Submit Leave Request',
      cancelRequest: 'Cancel Request',
      cancelConfirm: 'Are you sure you want to cancel this request?',
      checkDatesError: 'Please verify the selected dates',
      allHolidaysError: 'The selected range falls entirely on weekends or public holidays',
      sentSuccess: 'Your leave request has been sent to management for review.',
      emptyRequests: 'No leave requests recorded yet',
      statuses: {
        pending: 'Pending Review',
        approved: 'Approved',
        rejected: 'Rejected',
      },
    },

    // Payslips Page
    payslips: {
      currentMonthTitle: 'Current month earnings ({month})',
      runningNotice: 'This payslip updates automatically after each recorded shift through today. It becomes final once the month is approved and closed.',
      updatedBadge: 'Updated after each shift',
      completedDays: 'Completed workdays',
      absenceDays: 'Absence days',
      pendingReviews: 'Attendance awaiting supervisor review',
      overtime: 'Overtime',
      delaysAndEarly: 'Late arrivals & early departures',
      estimatedNet: 'Estimated Net Earnings to Date',
      finalNotice: 'All allowances and deductions are finalized when the monthly payroll is approved.',
      viewDetails: 'View Earnings Breakdown',
      archivedSlips: 'Previously approved payslips',
      archivedDesc: 'Payslips for previous months, approved by HR and Finance after payroll has been closed.',
      noArchivedSlips: 'No approved payslips are available yet.',
      viewOfficialSlip: 'View approved payslip',
      month: 'Month',
      baseSalary: 'Base Salary',
      netSalary: 'Net Salary',
      allowances: 'Allowances',
      deductions: 'Deductions',
    },

    // Approvals Page
    approvals: {
      title: 'Approvals and record review',
      subtitle: 'Review and approve leave requests, and correct incomplete attendance records.',
      tabLeaves: 'Leave Requests',
      tabAttendance: 'Attendance Review',
      tabAudit: 'Audit Log',
      pendingLeavesTitle: 'Pending Leave Approvals',
      pastLeavesTitle: 'Past Leave History',
      approveBtn: 'Approve',
      rejectBtn: 'Reject',
      confirmApprovePrompt: 'Are you sure you want to approve leave for {name}?',
      confirmRejectPrompt: 'Are you sure you want to reject leave for {name}?',
      approvedSuccess: 'Leave request approved successfully',
      rejectedSuccess: 'Leave request rejected',
      attentionRequiredTitle: 'Attendance records that need review',
      attentionSubtitle: 'Review pending attendance confirmations, then check incomplete clock-outs and late arrivals.',
      noAttentionNeeded: 'No incomplete attendance records or late arrivals need review.',
      verificationPending: 'Awaiting supervisor confirmation',
      verificationApproved: 'Attendance confirmed',
      verificationRejected: 'Attendance rejected',
      confirmAttendanceBtn: 'Confirm Attendance',
      attendanceConfirmed: 'Attendance confirmed.',
      attendanceConfirmedAudit: 'Attendance confirmed',
      attendanceRejectedAudit: 'Attendance rejected',
      reviewTitle: 'Review attendance: {name}',
      reviewNote: 'Reason for rejection (required)',
      verificationSaved: 'Attendance review decision saved.',
      verificationFailed: 'Unable to save the attendance decision.',
      auditAction: 'Action',
      correctBtn: 'Correct Record',
      modalCorrectTitle: 'Correct Attendance Record: {name}',
      correctionReasonRequired: 'Enter a reason to save this correction.',
      correctionSaved: 'The attendance correction was saved and logged.',
      auditTitle: 'Audit Log',
      noAuditRecords: 'No audit records found',
    },

    // Employees Page & Creation
    employees: {
      title: 'Employee management',
      createUserBtn: '+ Create user',
      createStaffTitle: 'Create Staff Account',
      createStaffSubtitle: 'Create a manager or supervisor account with a name and password. A national ID is not required.',
      createEmployeeTitle: 'Create Employee Account',
      createEmployeeSubtitle: 'Create an employee account with a name, 14-digit national ID, and password. The national ID is used as the username.',
      selectRolePrompt: 'Select a role for the new account:',
      pendingTitle: 'New registrations awaiting review',
      pendingSubtitle: 'Review employee details, activate accounts, and assign teams, branches, and salaries.',
      empty: 'No employees have been registered yet.',
      reviewAndActivate: 'Review & Activate',
      resetPassword: 'Reset Password',
      credentialsTitle: 'Credentials for {label}',
      credentialsNotice: 'Copy these credentials and share them with the user so they can sign in:',
      usernameIs: 'Username:',
      passwordIs: 'Password:',
    },
  },
};

let currentLang = localStorage.getItem('attn.lang') || 'en';

export function getLang() {
  return currentLang;
}

export function setLang(lang) {
  if (lang !== 'ar' && lang !== 'en') return;
  currentLang = lang;
  localStorage.setItem('attn.lang', lang);
  document.documentElement.setAttribute('lang', lang);
  document.documentElement.setAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
}

// Initialize HTML attributes on module load
document.documentElement.setAttribute('lang', currentLang);
document.documentElement.setAttribute('dir', currentLang === 'ar' ? 'rtl' : 'ltr');

export function t(path, vars = {}) {
  const parts = path.split('.');
  let val = translations[currentLang];
  for (const p of parts) {
    if (!val || typeof val !== 'object') return path;
    val = val[p];
  }
  if (typeof val === 'string') {
    return val.replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? vars[k] : `{${k}}`));
  }
  return val || path;
}
