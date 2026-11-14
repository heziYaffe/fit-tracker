/* Public cloud config. Fill these after you create a Supabase project and
   a Whoop developer app (see server/README.md). Never put the service role
   key or the Whoop client secret here. Empty WHOOP_CLIENT_ID keeps the
   Whoop section in "בקרוב"; account/sync is active once Supabase is set. */
(function (root) {
  'use strict';
  root.FitCloudConfig = {
    SUPABASE_URL: 'https://wnqlaajfqimkaibcnsti.supabase.co',
    SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InducWxhYWpmcWlta2FpYmNuc3RpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ2NTAwMzMsImV4cCI6MjExMDIyNjAzM30.h-mrGpBDNwMDl-Vx-6QxPDpBWZMLiPmTEP-OvW9fEIA',
    WHOOP_CLIENT_ID: '',
    WHOOP_FN_URL: 'https://wnqlaajfqimkaibcnsti.supabase.co/functions/v1/whoop'
  };
})(typeof window !== 'undefined' ? window : globalThis);
