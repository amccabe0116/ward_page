// Public site configuration. The anon key is safe to publish: the database only
// exposes the roll functions to it (see supabase/schema.sql). Admin actions
// additionally require the passphrase.
window.NP_CONFIG = {
  wardName: 'North Point YSA',
  supabaseUrl: 'https://YOUR-PROJECT-REF.supabase.co',
  supabaseAnonKey: 'YOUR-ANON-KEY',
  // Which LCR classes feed each roll button (used by the admin page + LCR sync).
  classes: {
    sunday_school: { label: 'Sunday School', short: 'Sunday School', orgTypeIds: [1255, 1256, 1257] },
    priesthood_rs: { label: 'Priesthood / Relief Society', short: 'Priesthood / RS', orgTypeIds: [70, 71, 74] },
  },
  timeZone: 'America/New_York',
};
