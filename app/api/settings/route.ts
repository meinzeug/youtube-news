import { NextRequest, NextResponse } from 'next/server'; import { getSettings,setSettings } from '@/lib/db';
export async function GET(){return NextResponse.json(getSettings())}
export async function POST(req:NextRequest){setSettings(await req.json()); return NextResponse.json({ok:true})}
