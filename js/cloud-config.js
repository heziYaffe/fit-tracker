/* Public cloud config. Fill these after you create a Supabase project and
   a Whoop developer app (see server/README.md). Never put the service role
   key or the Whoop client secret here. Empty values keep Settings in "בקרוב". */
(function (root) {
  'use strict';
  root.FitCloudConfig = {
    SUPABASE_URL: '',
    SUPABASE_ANON_KEY: '',
    WHOOP_CLIENT_ID: '',
    WHOOP_FN_URL: ''
  };
})(typeof window !== 'undefined' ? window : globalThis);
