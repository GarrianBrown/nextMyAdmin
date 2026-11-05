import { redirect } from "next/navigation";
import { safeNextPath, webAuthEnabled } from "@/lib/webAuth";
import LoginForm from "@/components/LoginForm";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  if (!webAuthEnabled()) redirect(safeNextPath(next));
  return (
    <div className="h-full flex items-center justify-center p-4">
      <LoginForm next={safeNextPath(next)} />
    </div>
  );
}
