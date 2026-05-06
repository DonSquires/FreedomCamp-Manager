/**
 * publicLocale.ts — B-11 Multi-language public portal
 *
 * Supported locales: English (en), Māori (mi), Mandarin Simplified (zh), Hindi (hi)
 *
 * Translation keys cover both public pages:
 *   zm.*  — Freedom Camping Zone Map
 *   nc.*  — Noise Complaint Portal
 *   lang  — Language switcher labels
 *   months — Month abbreviations (12 items, 1-indexed via months[month-1])
 */

export type Locale = 'en' | 'mi' | 'zh' | 'hi'

export interface PublicTranslations {
  lang: Record<Locale, string>
  months: string[]

  zm: {
    title: string
    subtitle: string
    disclaimer: string
    search: string
    loading: string
    zonesFoundSingular: string     // "1 zone found"
    zonesFoundPlural: string       // "{n} zones found"
    noZones: string
    statusOpen: string
    statusRestricted: string
    statusClosed: string
    dayVisitOnly: string
    maxNights: string              // "Max {n} consecutive night" (EN adds plural suffix)
    maxNightsPlural: string        // plural suffix — "s" for EN, "" for others
    maxNightsMonth: string         // "Max {n} nights/month"
    selfContained: string
    season: string                 // "Season: {from}–{to}"
    allowedDays: string
    managedBy: string
    bylaw: string
    viewBylaw: string
    viewOnMaps: string
    footerData: string
    footerNoise: string
    footerDispute: string
  }

  nc: {
    title: string
    subtitle: string
    emergencyLine1: string         // "For"
    emergencyBold1: string         // "emergencies or immediate threats"
    emergencyLine2: string         // "call"
    emergencyNumber: string        // "111"
    emergencyLine3: string         // rest of disclaimer
    tabSubmit: string
    tabStatus: string
    formTitle: string
    formRequired: string
    labelAddress: string
    placeholderAddress: string
    labelSuburb: string
    placeholderSuburb: string
    labelNoiseType: string
    placeholderNoiseType: string
    labelDescription: string
    placeholderDescription: string
    contactOptional: string
    labelName: string
    placeholderName: string
    labelPhone: string
    labelEmail: string
    btnSubmit: string
    btnSubmitting: string
    successTitle: string
    successRefLabel: string
    successSave: string
    btnCheckStatus: string
    btnSubmitAnother: string
    statusTitle: string
    statusDesc: string
    btnCheck: string
    btnChecking: string
    addrLabel: string
    submittedLabel: string
    updatedLabel: string
    officerMsgLabel: string
    errorNoComplaint: string
    errorLookupFailed: string
    errorRequired: string
    errorSubmitFailed: string
    toastSuccess: string
    footerEmergency: string
    footerZoneMap: string
    footerDispute: string
    enterRef: string
    noiseMusic: string
    noiseParty: string
    noiseMachinery: string
    noiseAnimals: string
    noiseConstruction: string
    noiseVehicle: string
    noiseOther: string
    statusReceived: string
    statusAcknowledged: string
    statusAssigned: string
    statusOnScene: string
    statusResolved: string
    statusNoAction: string
    placeholderPhone: string
    placeholderEmail: string
    jsLocale: string           // BCP-47 locale string for date formatting, e.g. 'en-NZ'
  }
}

// ─── English ──────────────────────────────────────────────────────────────────
const en: PublicTranslations = {
  lang: { en: 'English', mi: 'Māori', zh: '中文', hi: 'हिन्दी' },
  months: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  zm: {
    title: 'Freedom Camping Zone Map',
    subtitle: 'Check zone rules before you camp • No login required',
    disclaimer:
      'Zone rules are updated regularly but may not reflect real-time enforcement action. ' +
      'Always check on-site signage and comply with any notices issued by officers. ' +
      'Freedom Camping Act 2011 and local bylaws apply.',
    search: 'Search zones…',
    loading: 'Loading zones…',
    zonesFoundSingular: '1 zone found',
    zonesFoundPlural: '{n} zones found',
    noZones: 'No zones match your search.',
    statusOpen: 'Open',
    statusRestricted: 'Restricted',
    statusClosed: 'Closed',
    dayVisitOnly: 'Day visits only',
    maxNights: 'Max {n} consecutive night',
    maxNightsPlural: 's',
    maxNightsMonth: 'Max {n} nights/month',
    selfContained: 'Self-contained only',
    season: 'Season: {from}–{to}',
    allowedDays: 'Allowed days:',
    managedBy: 'Managed by:',
    bylaw: 'Bylaw:',
    viewBylaw: 'View bylaw',
    viewOnMaps: 'View on Google Maps',
    footerData: 'Data provided by FieldOps Manager · Freedom Camping Act 2011 applies',
    footerNoise: 'Report a noise issue',
    footerDispute: 'Dispute a notice',
  },
  nc: {
    title: 'Noise Complaint Portal',
    subtitle: 'Report a noise issue in your area • No login required',
    emergencyLine1: 'For',
    emergencyBold1: 'emergencies or immediate threats',
    emergencyLine2: 'call',
    emergencyNumber: '111',
    emergencyLine3:
      'This portal is for non-emergency noise complaints outside business hours. ' +
      'Your contact details are optional and will only be used to follow up on your complaint.',
    tabSubmit: 'Submit Complaint',
    tabStatus: 'Check Status',
    formTitle: 'Report a Noise Issue',
    formRequired: 'Fields marked * are required.',
    labelAddress: 'Address of noise source *',
    placeholderAddress: 'e.g. 12 Example Street',
    labelSuburb: 'Suburb / Area',
    placeholderSuburb: 'e.g. Napier Hill',
    labelNoiseType: 'Type of noise',
    placeholderNoiseType: 'Select type…',
    labelDescription: 'Describe the noise issue *',
    placeholderDescription:
      'Please describe what you can hear, when it started, and any other relevant details…',
    contactOptional: 'Your contact details (optional — only used for follow-up)',
    labelName: 'Name',
    placeholderName: 'Your name',
    labelPhone: 'Phone',
    labelEmail: 'Email',
    btnSubmit: 'Submit Complaint',
    btnSubmitting: 'Submitting…',
    successTitle: 'Complaint Received',
    successRefLabel: 'Your reference number is:',
    successSave:
      'Save this reference number. You can use it to check the status of your complaint on this page.',
    btnCheckStatus: 'Check Status',
    btnSubmitAnother: 'Submit Another',
    statusTitle: 'Check Complaint Status',
    statusDesc: 'Enter your reference number (e.g. NCC-2026-000001).',
    btnCheck: 'Check',
    btnChecking: 'Searching…',
    addrLabel: 'Address:',
    submittedLabel: 'Submitted:',
    updatedLabel: 'Last updated:',
    officerMsgLabel: 'Message from officer:',
    errorNoComplaint: 'No complaint found with that reference number.',
    errorLookupFailed: 'Lookup failed. Please try again.',
    errorRequired: 'Address and description are required',
    errorSubmitFailed: 'Submission failed. Please try again.',
    toastSuccess: 'Complaint submitted successfully',
    footerEmergency: 'For emergencies call 111',
    footerZoneMap: 'Freedom camping zone map',
    footerDispute: 'Dispute a notice',
    enterRef: 'Please enter a reference number',
    noiseMusic: 'Music / Loud Audio',
    noiseParty: 'Party / Social Gathering',
    noiseMachinery: 'Machinery / Power Tools',
    noiseAnimals: 'Animals (dogs, roosters, etc.)',
    noiseConstruction: 'Construction / Building Work',
    noiseVehicle: 'Vehicle (engine revving, exhausts)',
    noiseOther: 'Other',
    statusReceived: 'Received',
    statusAcknowledged: 'Acknowledged',
    statusAssigned: 'Officer Assigned',
    statusOnScene: 'Officer On Scene',
    statusResolved: 'Resolved',
    statusNoAction: 'No Action Taken',
    placeholderPhone: '021 000 0000',
    placeholderEmail: 'you@example.com',
    jsLocale: 'en-NZ',
  },
}

// ─── Māori (te reo Māori) ─────────────────────────────────────────────────────
const mi: PublicTranslations = {
  lang: { en: 'English', mi: 'Māori', zh: '中文', hi: 'हिन्दी' },
  months: ['Hān', 'Pēp', 'Māe', 'Āpe', 'Mei', 'Hun', 'Hūr', 'Āku', 'Hep', 'Oke', 'Noe', 'Tīh'],
  zm: {
    title: 'Mahere Noho Haumaru',
    subtitle: 'Tirohia ngā ture rohe i mua o tō noho • Kāore he takiuru e hiahiatia ana',
    disclaimer:
      'Ka whakahoutia ngā ture rohe i ngā wā katoa, engari kāhore pea e whakaata ana i ngā mahi whakauru ā-wā tūturu. ' +
      'Tirohia ngā tohu i te wāhi noho, ā, whai i ngā pānui nā ngā āpiha. ' +
      'Ka ārahina e te Ture Noho Haumaru 2011 me ngā ture-ā-rohe.',
    search: 'Rapua ngā rohe…',
    loading: 'Kei te uta ngā rohe…',
    zonesFoundSingular: '1 rohe i kitea',
    zonesFoundPlural: '{n} rohe i kitea',
    noZones: 'Kāore he rohe e tūhono ana ki tāu rapu.',
    statusOpen: 'Tuwhera',
    statusRestricted: 'Ārahina',
    statusClosed: 'Katia',
    dayVisitOnly: 'Tāwharau ā-rā anake',
    maxNights: 'Mōrea {n} pō haupāinga',
    maxNightsPlural: '',
    maxNightsMonth: 'Mōrea {n} pō i ia marama',
    selfContained: 'Waka ōkawa anake',
    season: 'Āu: {from}–{to}',
    allowedDays: 'Ngā rā āhei:',
    managedBy: 'Nā:',
    bylaw: 'Ture-ā-rohe:',
    viewBylaw: 'Tirohia te ture-ā-rohe',
    viewOnMaps: 'Tiro i runga i ngā Mahere Google',
    footerData: 'Raraunga nā FieldOps Manager · Ka ārahina e te Ture Noho Haumaru 2011',
    footerNoise: 'Tuku amuamu mō te haruru',
    footerDispute: 'Whakahē i tētahi pānui',
  },
  nc: {
    title: 'Whare Amuamu Haruru',
    subtitle: 'Tuku amuamu mō he take haruru i tōu rohe • Kāore he takiuru e hiahiatia ana',
    emergencyLine1: 'Mō ngā',
    emergencyBold1: 'āhuatanga ohorere',
    emergencyLine2: 'waea atu',
    emergencyNumber: '111',
    emergencyLine3:
      'Ko tēnei whare mō ngā amuamu haruru ehara i te ohorere i waho i ngā hāora mahi. ' +
      'He kōwhiringa āu kōrero whakapā, ka whakamahia anake mō te whakahoki kōrero.',
    tabSubmit: 'Tuku Amuamu',
    tabStatus: 'Tirohia te Āhua',
    formTitle: 'Ripoata he Take Haruru',
    formRequired: 'Ko ngā kāri e tohua ana * he hiahia.',
    labelAddress: 'Wāhitau o te puna haruru *',
    placeholderAddress: 'p. tauira 12 Tiriti Tauira',
    labelSuburb: 'Tāone iti / Rohe',
    placeholderSuburb: 'p. tauira Napier Hill',
    labelNoiseType: 'Momo haruru',
    placeholderNoiseType: 'Tīpakohia te momo…',
    labelDescription: 'Whakaahua i te take haruru *',
    placeholderDescription:
      'Whakaahuatia ōu rongo, nāia i tīmata ai, me ētahi atu kōrero e hāngai ana…',
    contactOptional: 'Ōu kōrero whakapā (kōwhiringa — ka whakamahia anake mō te whakahoki kōrero)',
    labelName: 'Ingoa',
    placeholderName: 'Tōu ingoa',
    labelPhone: 'Waea',
    labelEmail: 'Īmēra',
    btnSubmit: 'Tukua te Amuamu',
    btnSubmitting: 'Kei te tuku…',
    successTitle: 'Kua Whiwhi te Amuamu',
    successRefLabel: 'Ko tō tau tohutoro:',
    successSave:
      'Tiakina tēnei tau tohutoro. Ka taea e koe te huri ki te āhua o tōu amuamu i tēnei whārangi.',
    btnCheckStatus: 'Tirohia te Āhua',
    btnSubmitAnother: 'Tuku Anō',
    statusTitle: 'Tirohia te Āhua o te Amuamu',
    statusDesc: 'Tāuruhia tō tau tohutoro (p. tauira NCC-2026-000001).',
    btnCheck: 'Tirohia',
    btnChecking: 'Kei te rapu…',
    addrLabel: 'Wāhitau:',
    submittedLabel: 'I tukua:',
    updatedLabel: 'I whakahoutia whakamutunga:',
    officerMsgLabel: 'Karere mai i te āpiha:',
    errorNoComplaint: 'Kāore he amuamu i kitea mō taua tau tohutoro.',
    errorLookupFailed: 'I rahua te rapu. Ngana anō.',
    errorRequired: 'Ko te wāhitau me te whakaahuatanga he hiahia',
    errorSubmitFailed: 'I rahua te tuku. Ngana anō.',
    toastSuccess: 'I angitu te tuku o te amuamu',
    footerEmergency: 'Mō ngā ohorere waea 111',
    footerZoneMap: 'Mahere rohe noho haumaru',
    footerDispute: 'Whakahē i tētahi pānui',
    enterRef: 'Tāuruhia he tau tohutoro',
    noiseMusic: 'Puoro / Oro Reo Nui',
    noiseParty: 'Hākari / Huihuinga',
    noiseMachinery: 'Mihini / Taputapu Hiko',
    noiseAnimals: 'Kararehe (kurī, tīkokako, ōrite)',
    noiseConstruction: 'Hanga / Mahi Whare',
    noiseVehicle: 'Waka (pū, ngongo)',
    noiseOther: 'Ētahi atu',
    statusReceived: 'Kua Whiwhi',
    statusAcknowledged: 'Kua Mōhiotia',
    statusAssigned: 'Kua Tohua he Āpiha',
    statusOnScene: 'Kei te Wāhi te Āpiha',
    statusResolved: 'Kua Whakatauia',
    statusNoAction: 'Kāore he Mahi i Mahia',
    placeholderPhone: '021 000 0000',
    placeholderEmail: 'koe@tauira.com',
    jsLocale: 'mi',
  },
}

// ─── Mandarin Simplified (zh) ─────────────────────────────────────────────────
const zh: PublicTranslations = {
  lang: { en: 'English', mi: 'Māori', zh: '中文', hi: 'हिन्दी' },
  months: ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'],
  zm: {
    title: '自由露营区地图',
    subtitle: '露营前请查阅区域规则 • 无需登录',
    disclaimer:
      '区域规则定期更新，但可能未能反映实时执法行动。请务必查看现场标识并遵守执法人员发出的任何通知。' +
      '《2011年自由露营法》及地方法规适用。',
    search: '搜索区域…',
    loading: '正在加载区域…',
    zonesFoundSingular: '找到 1 个区域',
    zonesFoundPlural: '找到 {n} 个区域',
    noZones: '没有符合搜索条件的区域。',
    statusOpen: '开放',
    statusRestricted: '限制',
    statusClosed: '关闭',
    dayVisitOnly: '仅限日间参观',
    maxNights: '最多连续住 {n} 晚',
    maxNightsPlural: '',
    maxNightsMonth: '每月最多住 {n} 晚',
    selfContained: '仅限自给自足车辆',
    season: '开放季节：{from}–{to}',
    allowedDays: '允许日期：',
    managedBy: '管理机构：',
    bylaw: '地方法规：',
    viewBylaw: '查看法规',
    viewOnMaps: '在谷歌地图上查看',
    footerData: '数据由 FieldOps Manager 提供 · 《2011年自由露营法》适用',
    footerNoise: '投诉噪音问题',
    footerDispute: '对通知提出异议',
  },
  nc: {
    title: '噪音投诉门户',
    subtitle: '举报您所在地区的噪音问题 • 无需登录',
    emergencyLine1: '如遇',
    emergencyBold1: '紧急情况或即时威胁',
    emergencyLine2: '请拨打',
    emergencyNumber: '111',
    emergencyLine3:
      '本门户用于非紧急噪音投诉（营业时间外）。您的联系方式为可选填写，仅用于后续跟进。',
    tabSubmit: '提交投诉',
    tabStatus: '查询状态',
    formTitle: '举报噪音问题',
    formRequired: '标有 * 的字段为必填项。',
    labelAddress: '噪音来源地址 *',
    placeholderAddress: '例如：12 示例街',
    labelSuburb: '市郊 / 区域',
    placeholderSuburb: '例如：Napier Hill',
    labelNoiseType: '噪音类型',
    placeholderNoiseType: '选择类型…',
    labelDescription: '描述噪音问题 *',
    placeholderDescription: '请描述您听到的噪音、开始时间及其他相关信息…',
    contactOptional: '您的联系方式（可选 — 仅用于后续跟进）',
    labelName: '姓名',
    placeholderName: '您的姓名',
    labelPhone: '电话',
    labelEmail: '电子邮件',
    btnSubmit: '提交投诉',
    btnSubmitting: '提交中…',
    successTitle: '投诉已收到',
    successRefLabel: '您的参考编号是：',
    successSave: '请保存此参考编号。您可以在本页面使用它查询投诉状态。',
    btnCheckStatus: '查询状态',
    btnSubmitAnother: '再次提交',
    statusTitle: '查询投诉状态',
    statusDesc: '请输入您的参考编号（例如 NCC-2026-000001）。',
    btnCheck: '查询',
    btnChecking: '搜索中…',
    addrLabel: '地址：',
    submittedLabel: '提交时间：',
    updatedLabel: '最后更新：',
    officerMsgLabel: '执法人员留言：',
    errorNoComplaint: '未找到该参考编号对应的投诉。',
    errorLookupFailed: '查询失败，请重试。',
    errorRequired: '地址和描述为必填项',
    errorSubmitFailed: '提交失败，请重试。',
    toastSuccess: '投诉提交成功',
    footerEmergency: '紧急情况请拨打 111',
    footerZoneMap: '自由露营区地图',
    footerDispute: '对通知提出异议',
    enterRef: '请输入参考编号',
    noiseMusic: '音乐 / 高音音频',
    noiseParty: '聚会 / 社交聚会',
    noiseMachinery: '机械 / 电动工具',
    noiseAnimals: '动物（狗、公鸡等）',
    noiseConstruction: '建筑 / 施工',
    noiseVehicle: '车辆（发动机轰鸣、排气）',
    noiseOther: '其他',
    statusReceived: '已收到',
    statusAcknowledged: '已确认',
    statusAssigned: '已指派执法人员',
    statusOnScene: '执法人员已到场',
    statusResolved: '已解决',
    statusNoAction: '未采取行动',
    placeholderPhone: '021 000 0000',
    placeholderEmail: 'you@example.com',
    jsLocale: 'zh-NZ',
  },
}

// ─── Hindi ────────────────────────────────────────────────────────────────────
const hi: PublicTranslations = {
  lang: { en: 'English', mi: 'Māori', zh: '中文', hi: 'हिन्दी' },
  months: ['जन', 'फर', 'मार', 'अप्र', 'मई', 'जून', 'जुल', 'अग', 'सित', 'अक्त', 'नव', 'दिस'],
  zm: {
    title: 'स्वतंत्र कैम्पिंग क्षेत्र मानचित्र',
    subtitle: 'कैम्पिंग से पहले क्षेत्र के नियम जांचें • लॉगिन की आवश्यकता नहीं',
    disclaimer:
      'क्षेत्र के नियम नियमित रूप से अपडेट किए जाते हैं लेकिन वास्तविक समय की प्रवर्तन कार्रवाई को प्रतिबिंबित नहीं कर सकते। ' +
      'साइट पर लगे संकेत हमेशा देखें और अधिकारियों द्वारा जारी किसी भी नोटिस का पालन करें। ' +
      'स्वतंत्र कैम्पिंग अधिनियम 2011 और स्थानीय उपविधियां लागू होती हैं।',
    search: 'क्षेत्र खोजें…',
    loading: 'क्षेत्र लोड हो रहे हैं…',
    zonesFoundSingular: '1 क्षेत्र मिला',
    zonesFoundPlural: '{n} क्षेत्र मिले',
    noZones: 'आपकी खोज से मेल खाने वाला कोई क्षेत्र नहीं।',
    statusOpen: 'खुला',
    statusRestricted: 'प्रतिबंधित',
    statusClosed: 'बंद',
    dayVisitOnly: 'केवल दिन की यात्रा',
    maxNights: 'अधिकतम {n} लगातार रात',
    maxNightsPlural: 'ें',
    maxNightsMonth: 'प्रति माह अधिकतम {n} रातें',
    selfContained: 'केवल स्व-निहित वाहन',
    season: 'मौसम: {from}–{to}',
    allowedDays: 'अनुमत दिन:',
    managedBy: 'प्रबंधित:',
    bylaw: 'उपविधि:',
    viewBylaw: 'उपविधि देखें',
    viewOnMaps: 'Google Maps पर देखें',
    footerData: 'डेटा FieldOps Manager द्वारा प्रदान · स्वतंत्र कैम्पिंग अधिनियम 2011 लागू',
    footerNoise: 'शोर की समस्या रिपोर्ट करें',
    footerDispute: 'नोटिस का विवाद करें',
  },
  nc: {
    title: 'शोर शिकायत पोर्टल',
    subtitle: 'अपने क्षेत्र में शोर की समस्या रिपोर्ट करें • लॉगिन की आवश्यकता नहीं',
    emergencyLine1: 'आपातकाल या',
    emergencyBold1: 'तत्काल खतरे',
    emergencyLine2: 'के लिए',
    emergencyNumber: '111',
    emergencyLine3:
      'यह पोर्टल कार्य-घंटों के बाहर गैर-आपातकालीन शोर शिकायतों के लिए है। ' +
      'आपकी संपर्क जानकारी वैकल्पिक है और केवल अनुवर्ती कार्रवाई के लिए उपयोग की जाएगी।',
    tabSubmit: 'शिकायत दर्ज करें',
    tabStatus: 'स्थिति जांचें',
    formTitle: 'शोर की समस्या रिपोर्ट करें',
    formRequired: '* से चिह्नित फ़ील्ड आवश्यक हैं।',
    labelAddress: 'शोर स्रोत का पता *',
    placeholderAddress: 'जैसे 12 उदाहरण स्ट्रीट',
    labelSuburb: 'उपनगर / क्षेत्र',
    placeholderSuburb: 'जैसे Napier Hill',
    labelNoiseType: 'शोर का प्रकार',
    placeholderNoiseType: 'प्रकार चुनें…',
    labelDescription: 'शोर की समस्या बताएं *',
    placeholderDescription: 'कृपया बताएं कि आप क्या सुन रहे हैं, यह कब शुरू हुआ और कोई अन्य प्रासंगिक जानकारी…',
    contactOptional: 'आपकी संपर्क जानकारी (वैकल्पिक — केवल अनुवर्ती के लिए उपयोग किया जाएगा)',
    labelName: 'नाम',
    placeholderName: 'आपका नाम',
    labelPhone: 'फ़ोन',
    labelEmail: 'ईमेल',
    btnSubmit: 'शिकायत दर्ज करें',
    btnSubmitting: 'सबमिट हो रहा है…',
    successTitle: 'शिकायत प्राप्त हुई',
    successRefLabel: 'आपका संदर्भ संख्या है:',
    successSave: 'यह संदर्भ संख्या सहेजें। आप इसका उपयोग इस पृष्ठ पर अपनी शिकायत की स्थिति जांचने के लिए कर सकते हैं।',
    btnCheckStatus: 'स्थिति जांचें',
    btnSubmitAnother: 'और शिकायत दर्ज करें',
    statusTitle: 'शिकायत की स्थिति जांचें',
    statusDesc: 'अपना संदर्भ संख्या दर्ज करें (जैसे NCC-2026-000001)।',
    btnCheck: 'जांचें',
    btnChecking: 'खोज रहे हैं…',
    addrLabel: 'पता:',
    submittedLabel: 'दर्ज की गई:',
    updatedLabel: 'अंतिम अपडेट:',
    officerMsgLabel: 'अधिकारी का संदेश:',
    errorNoComplaint: 'उस संदर्भ संख्या से कोई शिकायत नहीं मिली।',
    errorLookupFailed: 'खोज विफल रही। कृपया पुनः प्रयास करें।',
    errorRequired: 'पता और विवरण आवश्यक हैं',
    errorSubmitFailed: 'सबमिशन विफल रहा। कृपया पुनः प्रयास करें।',
    toastSuccess: 'शिकायत सफलतापूर्वक दर्ज की गई',
    footerEmergency: 'आपातकाल के लिए 111 पर कॉल करें',
    footerZoneMap: 'स्वतंत्र कैम्पिंग क्षेत्र मानचित्र',
    footerDispute: 'नोटिस का विवाद करें',
    enterRef: 'कृपया एक संदर्भ संख्या दर्ज करें',
    noiseMusic: 'संगीत / तेज़ ऑडियो',
    noiseParty: 'पार्टी / सामाजिक समारोह',
    noiseMachinery: 'मशीनरी / बिजली उपकरण',
    noiseAnimals: 'जानवर (कुत्ते, मुर्गे आदि)',
    noiseConstruction: 'निर्माण / भवन कार्य',
    noiseVehicle: 'वाहन (इंजन शोर, निकास)',
    noiseOther: 'अन्य',
    statusReceived: 'प्राप्त हुई',
    statusAcknowledged: 'स्वीकृत',
    statusAssigned: 'अधिकारी नियुक्त',
    statusOnScene: 'अधिकारी मौके पर',
    statusResolved: 'हल हो गई',
    statusNoAction: 'कोई कार्रवाई नहीं',
    placeholderPhone: '021 000 0000',
    placeholderEmail: 'you@example.com',
    jsLocale: 'hi',
  },
}

// ─── Locale dictionary ────────────────────────────────────────────────────────
export const LOCALES: Record<Locale, PublicTranslations> = { en, mi, zh, hi }

/** Detect locale from browser language setting, falling back to 'en'. */
export function detectLocale(): Locale {
  const stored = typeof localStorage !== 'undefined'
    ? (localStorage.getItem('public-locale') as Locale | null)
    : null
  if (stored && stored in LOCALES) return stored

  const nav = typeof navigator !== 'undefined' ? navigator.language : 'en'
  const prefix = nav.split('-')[0].toLowerCase()
  if (prefix === 'mi') return 'mi'
  if (prefix === 'zh') return 'zh'
  if (prefix === 'hi') return 'hi'
  return 'en'
}

/**
 * Replace `{key}` placeholders in a translation string.
 * e.g. tpl("Max {n} nights", { n: 3 }) → "Max 3 nights"
 */
export function tpl(str: string, params: Record<string, string | number>): string {
  return Object.entries(params).reduce(
    (acc, [k, v]) => acc.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v)),
    str,
  )
}
