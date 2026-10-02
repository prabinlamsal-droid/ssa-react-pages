// Node-side config: proxy headers stay in Node, never in browser HTML.
// Run against a team-approved staging endpoint, never with production credentials.
export default {
 endpoints:{kycCountry:{url:'/api/countries'}},
 proxy:{
  '/api':{
   target:process.env.ARCBRIDGE_DEV_API_URL ?? 'http://127.0.0.1:3000',
   changeOrigin:true,
   ...(process.env.ARCBRIDGE_DEV_TOKEN ? {headers:{authorization:'Bearer '+process.env.ARCBRIDGE_DEV_TOKEN}} : {}),
  },
 },
};
