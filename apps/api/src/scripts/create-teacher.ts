import {parseArgs} from 'node:util';
import {z} from 'zod';
import {db,pool} from '../db/index.js';
import {hashPassword} from '../lib/password.js';
const {values}=parseArgs({options:{username:{type:'string'},password:{type:'string'},name:{type:'string'}}});
try{
  const data=z.object({username:z.string().min(3).max(150),password:z.string().min(12).max(200),name:z.string().min(1).max(150)}).parse(values);
  if(await db.one('SELECT id FROM users WHERE username=?',[data.username]))throw new Error('Username already exists; no account was modified.');
  await db.run('INSERT INTO users(username,password,first_name,role,is_staff,bio) VALUES (?,?,?,\'teacher\',1,\'\')',[data.username,await hashPassword(data.password),data.name]);
  console.log('Teacher created.');
}finally{await pool.end();}
