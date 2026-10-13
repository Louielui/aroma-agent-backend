'use strict'
const MAX_FRAME=50000
function encode(message){const bytes=Buffer.from(JSON.stringify(message));if(bytes.length>200000)throw Error('native_response_too_large');const header=Buffer.alloc(4);header.writeUInt32LE(bytes.length);return Buffer.concat([header,bytes])}
function createReader(onMessage,onError){let buffer=Buffer.alloc(0),closed=false;return chunk=>{
 if(closed)return
 buffer=Buffer.concat([buffer,chunk])
 while(buffer.length>=4){const size=buffer.readUInt32LE();if(!size||size>MAX_FRAME){closed=true;onError();return}if(buffer.length<size+4)return;let value;try{value=JSON.parse(buffer.subarray(4,4+size).toString('utf8'))}catch{closed=true;onError();return}buffer=buffer.subarray(size+4);onMessage(value)}
}}
module.exports={MAX_FRAME,encode,createReader}
