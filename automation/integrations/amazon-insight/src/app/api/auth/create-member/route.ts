export async function POST() {
  return Response.json({ error: "当前使用共用登录账号，不再创建成员账号。请使用现有共用账号登录。" }, { status: 410 });
}
