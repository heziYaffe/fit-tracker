/* Public cloud config. Never put the service role key or the Whoop
   client secret here. The Whoop OAuth URL is built on the server, so the
   client id does not need to live in this file. WHOOP_ENABLED turns on
   the Whoop section once the function URL is set. */
(function (root) {
  'use strict';
  root.FitCloudConfig = {
    SUPABASE_URL: 'https://wnqlaajfqimkaibcnsti.supabase.co',
    SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InducWxhYWpmcWlta2FpYmNuc3RpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ2NTAwMzMsImV4cCI6MjExMDIyNjAzM30.h-mrGpBDNwMDl-Vx-6QxPDpBWZMLiPmTEP-OvW9fEIA',
    WHOOP_CLIENT_ID: '',
    WHOOP_ENABLED: true,
    WHOOP_FN_URL: 'https://wnqlaajfqimkaibcnsti.supabase.co/functions/v1/whoop'
  };
})(typeof window !== 'undefined' ? window : globalThis);
