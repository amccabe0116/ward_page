// Public site configuration. The anon key is safe to publish: the database only
// exposes the roll functions to it (see supabase/schema.sql). Admin actions
// additionally require the passphrase.
window.NP_CONFIG = {
  wardName: 'North Point YSA',
  supabaseUrl: 'https://utkbhlyvmfbtjyfqeoze.supabase.co',
  supabaseAnonKey: 'sb_publishable_F09ditwQQ-GfJ3W5AYk9MA__gF1N_C-',
  // Which LCR classes feed each roll button (used by the admin page + LCR sync).
  classes: {
    sunday_school: { label: 'Sunday School', short: 'Sunday School', orgTypeIds: [1255, 1256, 1257] },
    priesthood_rs: { label: 'Priesthood / Relief Society', short: 'Priesthood / RS', orgTypeIds: [70, 71, 74] },
  },
  timeZone: 'America/New_York',
  // Community links shown on the home page (leave a value empty to hide it).
  links: {
    facebook: 'https://www.facebook.com/share/g/1EBje3B48V/',
    whatsapp: '',
  },
};
