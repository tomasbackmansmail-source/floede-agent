import { createClient } from '@supabase/supabase-js';
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const { data } = await sb.from('discovery_configs').select('municipality, config, verified').eq('verified', true).eq('approved', true).limit(1);
console.log('Kommun:', data[0].municipality);
console.log('URL:', data[0].config?.listing_url);
