import {defineConfig} from '@naasa/arcbridge/config';
export default defineConfig({
 appId:'ssa-react-pages',
 contractFile:'./arcbridge.contract.json',
 browserDevelopmentConfig:'./arcbridge.dev.mjs',
 flutter:{assetDirectory:'../Naasa-X-Self-Service/packages/naasa_x/assets/web_bridge'},
 devOnly:['./arcbridge.dev.mjs','./arcbridge.dev.example.mjs'],
});
