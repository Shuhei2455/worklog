import { NextResponse } from "next/server";

// compose の疎通確認用。DBに触らないので起動直後でも200を返す。
// DBまで含めた確認は M0-b でスキーマを入れてから足す。
export async function GET() {
  return NextResponse.json({ status: "ok", app: "kadai" });
}
