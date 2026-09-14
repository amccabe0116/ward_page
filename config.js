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
  // Leaders › Callings: "Refresh from Google Sheets" posts to the Apps Script web app
  // (scripts/announcements.gs → Deploy → Web app). Leave empty until it is deployed.
  sheetsRefreshUrl: 'https://script.google.com/macros/s/AKfycbxlQHO7C0BknUnBmvYhSw2c7yMmR-Gr7OqHJdVGE2k5LM6wcNlVVemqH06o7yoCqSkkuA/exec',
  // Community links shown on the home page (leave a value empty to hide it).
  links: {
    facebook: 'https://www.facebook.com/share/g/1EBje3B48V/',
    whatsapp: 'https://chat.whatsapp.com/HHJ3Wfl0GXxEe5MCjABduZ',
    // Ward text list: opens a text to this number with the message started for them.
    textList: { number: '770-470-3577', body: 'Please add me to the ward text list. My name is ' },
  },
};
