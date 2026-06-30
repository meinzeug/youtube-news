import { NextResponse } from 'next/server'; import { sql } from '@/lib/db';
export async function GET(){return NextResponse.json(sql.prepare('select * from articles order by createdAt desc').all())}
