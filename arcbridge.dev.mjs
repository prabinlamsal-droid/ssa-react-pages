// Public development fixtures. This module is never read by mobile builds.
// Copy arcbridge.dev.example.mjs into an ignored local file for real staging APIs,
// then update browserDevelopmentConfig in a local config checkout.
export default {
 endpoints:{
  kycCountry:{fixture:{data:[
   {id:'np',name:'Nepal',slug:'nepal'},
   {id:'in',name:'India',slug:'india'},
  ]}},
 },
};
