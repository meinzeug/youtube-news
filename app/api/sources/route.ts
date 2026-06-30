import { NextRequest, NextResponse } from 'next/server'; import { sql } from '@/lib/db';
export async function GET(){return NextResponse.json(sql.prepare('select * from sources order by id desc').all())}
export async function POST(req:NextRequest){const b=await req.json(); sql.prepare('insert into sources(name,url,intervalMinutes,active) values(?,?,?,?)').run(b.name,b.url,Number(b.intervalMinutes||30),b.active?1:0); return NextResponse.json({ok:true})}
