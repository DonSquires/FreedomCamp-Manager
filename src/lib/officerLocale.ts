/**
 * officerLocale.ts — B-19 Multi-language Officer UI
 *
 * Supported locales:
 *   en — English (NZ)
 *   mi — Māori
 *   zh — Mandarin Simplified
 *   hi — Hindi
 *
 * Coverage:
 *   officer.* — FieldOfficerPortal + OfficerHomePage strings
 *   lang       — Language switcher labels
 */

export type OfficerLocale = 'en' | 'mi' | 'zh' | 'hi'

export interface OfficerTranslations {
  lang: Record<OfficerLocale, string>

  officer: {
    // Service type labels
    serviceSelectTitle: string
    serviceFreedomCamping: string
    serviceGuarding: string
    serviceParking: string
    serviceNoise: string
    serviceBiosecurity: string
    serviceSmoke: string

    // Shift actions
    startShift: string
    endShift: string
    startingShift: string
    endingShift: string
    shiftActive: string
    noShiftToday: string
    requestAdHocShift: string
    viewOpenShifts: string
    teamChat: string

    // Patrol actions
    startPatrol: string
    endPatrol: string
    patrol: string
    activePatrol: string
    livePatrol: string
    patrol24hHistory: string
    viewHistory: string

    // Observation / scan
    scanVehicle: string
    captureObs: string
    captureDone: string
    capturingObs: string
    reportBreach: string
    noBreach: string
    observation: string

    // Welfare
    welfareCheck: string
    sos: string
    manDown: string

    // General
    submit: string
    submitting: string
    cancel: string
    save: string
    close: string
    confirm: string
    loading: string
    selectZone: string
    notes: string
    emergency: string
    emergencyAssist: string
  }
}

// ─── English (base) ───────────────────────────────────────────────────────────

const EN: OfficerTranslations = {
  lang: { en: 'EN', mi: 'MĀ', zh: '中', hi: 'हि' },
  officer: {
    serviceSelectTitle:     'Select Service',
    serviceFreedomCamping:  'Freedom Camping Patrol',
    serviceGuarding:        'Guarding',
    serviceParking:         'Parking Enforcement',
    serviceNoise:           'Noise Control',
    serviceBiosecurity:     'Biosecurity Inspection',
    serviceSmoke:           'Smoke / OOH',

    startShift:             'Start Shift',
    endShift:               'End Shift',
    startingShift:          'Starting…',
    endingShift:            'Ending…',
    shiftActive:            'Shift Active',
    noShiftToday:           'No shift rostered for today',
    requestAdHocShift:      'Request Ad-hoc Shift',
    viewOpenShifts:         'View Open Shifts',
    teamChat:               'Team Chat',

    startPatrol:            'Start Patrol',
    endPatrol:              'End Patrol',
    patrol:                 'Patrol',
    activePatrol:           'Active Patrol',
    livePatrol:             'Live Patrol',
    patrol24hHistory:       'View 24h History',
    viewHistory:            'View History',

    scanVehicle:            'Scan Vehicle',
    captureObs:             'Capture Observation',
    captureDone:            'Observation captured',
    capturingObs:           'Capturing…',
    reportBreach:           'Report Breach',
    noBreach:               'No Breach',
    observation:            'Observation',

    welfareCheck:           'Welfare Check',
    sos:                    'SOS',
    manDown:                'Man Down',

    submit:                 'Submit',
    submitting:             'Submitting…',
    cancel:                 'Cancel',
    save:                   'Save',
    close:                  'Close',
    confirm:                'Confirm',
    loading:                'Loading…',
    selectZone:             'Select zone',
    notes:                  'Notes',
    emergency:              'Emergency',
    emergencyAssist:        'Emergency Assist',
  },
}

// ─── Māori ────────────────────────────────────────────────────────────────────

const MI: OfficerTranslations = {
  lang: EN.lang,
  officer: {
    serviceSelectTitle:     'Tīpako Ratonga',
    serviceFreedomCamping:  'Tūāpuni Rangimārie',
    serviceGuarding:        'Tiaki Wāhi',
    serviceParking:         'Whakahaere Tūnga',
    serviceNoise:           'Whakahaere Raru',
    serviceBiosecurity:     'Tirotiro Koiora',
    serviceSmoke:           'Auahi / OOH',

    startShift:             'Tīmata Hāora',
    endShift:               'Mutu Hāora',
    startingShift:          'E tīmata ana…',
    endingShift:            'E mutu ana…',
    shiftActive:            'Hāora Hohe',
    noShiftToday:           'Kāore he hāora i tēnei rā',
    requestAdHocShift:      'Tonoa Hāora Tūturu',
    viewOpenShifts:         'Tirohia ngā Hāora Tuwhera',
    teamChat:               'Kōrero Rōpū',

    startPatrol:            'Tīmata Tūāpuni',
    endPatrol:              'Mutu Tūāpuni',
    patrol:                 'Tūāpuni',
    activePatrol:           'Tūāpuni Hohe',
    livePatrol:             'Tūāpuni Ora',
    patrol24hHistory:       'Tirohia ngā 24h',
    viewHistory:            'Tirohia Hītori',

    scanVehicle:            'Matawhai Waka',
    captureObs:             'Pupuri Kitenga',
    captureDone:            'Kitenga kua pupuritia',
    capturingObs:           'E pupuri ana…',
    reportBreach:           'Pūrongo Takahi',
    noBreach:               'Kāore he Takahi',
    observation:            'Kitenga',

    welfareCheck:           'Tirotiro Oranga',
    sos:                    'SOS',
    manDown:                'Tangata Hinga',

    submit:                 'Tukua',
    submitting:             'E tukua ana…',
    cancel:                 'Whakakore',
    save:                   'Tiaki',
    close:                  'Kati',
    confirm:                'Whakau',
    loading:                'E uta ana…',
    selectZone:             'Tīpako rohe',
    notes:                  'Tuhinga',
    emergency:              'Ohotata',
    emergencyAssist:        'Āwhina Ohotata',
  },
}

// ─── Mandarin Simplified ──────────────────────────────────────────────────────

const ZH: OfficerTranslations = {
  lang: EN.lang,
  officer: {
    serviceSelectTitle:     '选择服务',
    serviceFreedomCamping:  '自由露营巡逻',
    serviceGuarding:        '保安',
    serviceParking:         '停车执法',
    serviceNoise:           '噪音管控',
    serviceBiosecurity:     '生物安全检查',
    serviceSmoke:           '烟雾 / 非工作时间',

    startShift:             '开始班次',
    endShift:               '结束班次',
    startingShift:          '开始中…',
    endingShift:            '结束中…',
    shiftActive:            '班次进行中',
    noShiftToday:           '今日无排班',
    requestAdHocShift:      '申请临时班次',
    viewOpenShifts:         '查看开放班次',
    teamChat:               '团队聊天',

    startPatrol:            '开始巡逻',
    endPatrol:              '结束巡逻',
    patrol:                 '巡逻',
    activePatrol:           '巡逻进行中',
    livePatrol:             '实时巡逻',
    patrol24hHistory:       '查看24小时记录',
    viewHistory:            '查看历史',

    scanVehicle:            '扫描车辆',
    captureObs:             '记录观察',
    captureDone:            '观察已记录',
    capturingObs:           '记录中…',
    reportBreach:           '报告违规',
    noBreach:               '无违规',
    observation:            '观察',

    welfareCheck:           '健康检查',
    sos:                    'SOS',
    manDown:                '人员倒下',

    submit:                 '提交',
    submitting:             '提交中…',
    cancel:                 '取消',
    save:                   '保存',
    close:                  '关闭',
    confirm:                '确认',
    loading:                '加载中…',
    selectZone:             '选择区域',
    notes:                  '备注',
    emergency:              '紧急',
    emergencyAssist:        '紧急援助',
  },
}

// ─── Hindi ────────────────────────────────────────────────────────────────────

const HI: OfficerTranslations = {
  lang: EN.lang,
  officer: {
    serviceSelectTitle:     'सेवा चुनें',
    serviceFreedomCamping:  'फ्रीडम कैंपिंग गश्त',
    serviceGuarding:        'सुरक्षा',
    serviceParking:         'पार्किंग प्रवर्तन',
    serviceNoise:           'शोर नियंत्रण',
    serviceBiosecurity:     'जैव-सुरक्षा निरीक्षण',
    serviceSmoke:           'धुआं / OOH',

    startShift:             'शिफ्ट शुरू करें',
    endShift:               'शिफ्ट समाप्त करें',
    startingShift:          'शुरू हो रहा है…',
    endingShift:            'समाप्त हो रहा है…',
    shiftActive:            'शिफ्ट सक्रिय',
    noShiftToday:           'आज के लिए कोई शिफ्ट निर्धारित नहीं',
    requestAdHocShift:      'तदर्थ शिफ्ट का अनुरोध करें',
    viewOpenShifts:         'खुली शिफ्ट देखें',
    teamChat:               'टीम चैट',

    startPatrol:            'गश्त शुरू करें',
    endPatrol:              'गश्त समाप्त करें',
    patrol:                 'गश्त',
    activePatrol:           'सक्रिय गश्त',
    livePatrol:             'लाइव गश्त',
    patrol24hHistory:       '24घं इतिहास देखें',
    viewHistory:            'इतिहास देखें',

    scanVehicle:            'वाहन स्कैन करें',
    captureObs:             'अवलोकन रिकॉर्ड करें',
    captureDone:            'अवलोकन दर्ज हुआ',
    capturingObs:           'दर्ज हो रहा है…',
    reportBreach:           'उल्लंघन रिपोर्ट करें',
    noBreach:               'कोई उल्लंघन नहीं',
    observation:            'अवलोकन',

    welfareCheck:           'कल्याण जाँच',
    sos:                    'SOS',
    manDown:                'कर्मी गिरा',

    submit:                 'सबमिट करें',
    submitting:             'सबमिट हो रहा है…',
    cancel:                 'रद्द करें',
    save:                   'सहेजें',
    close:                  'बंद करें',
    confirm:                'पुष्टि करें',
    loading:                'लोड हो रहा है…',
    selectZone:             'क्षेत्र चुनें',
    notes:                  'नोट्स',
    emergency:              'आपातकाल',
    emergencyAssist:        'आपातकालीन सहायता',
  },
}

// ─── Locale map + utilities ───────────────────────────────────────────────────

export const OFFICER_LOCALES: Record<OfficerLocale, OfficerTranslations> = {
  en: EN,
  mi: MI,
  zh: ZH,
  hi: HI,
}

/**
 * Detect locale from the user_profiles.preferred_language field (e.g. "en-NZ")
 * or browser navigator, falling back to localStorage key 'officer-locale'.
 */
export function detectOfficerLocale(profileLang?: string | null): OfficerLocale {
  // 1. From profile preferred_language (e.g. "en-NZ", "mi-NZ", "zh-Hans-NZ", "hi-IN")
  if (profileLang) {
    const norm = profileLang.toLowerCase()
    if (norm.startsWith('mi')) return 'mi'
    if (norm.startsWith('zh')) return 'zh'
    if (norm.startsWith('hi')) return 'hi'
    return 'en'
  }
  // 2. localStorage override
  if (typeof localStorage !== 'undefined') {
    const saved = localStorage.getItem('officer-locale') as OfficerLocale | null
    if (saved && OFFICER_LOCALES[saved]) return saved
  }
  // 3. Browser language
  const nav = typeof navigator !== 'undefined' ? navigator.language : 'en'
  const norm = nav.toLowerCase()
  if (norm.startsWith('mi')) return 'mi'
  if (norm.startsWith('zh')) return 'zh'
  if (norm.startsWith('hi')) return 'hi'
  return 'en'
}
