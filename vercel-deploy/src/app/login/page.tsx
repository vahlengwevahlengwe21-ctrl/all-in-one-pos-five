import Image from 'next/image';
import { LoginForm } from '@/components/auth/login-form';

export default function LoginPage() {
  return (
    <div className="flex min-h-screen w-full flex-col items-center justify-center bg-background p-4">
      <div className="mb-8 flex items-center gap-3 text-foreground sm:mb-10 sm:gap-4">
        <div className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-2xl bg-white p-1.5 shadow-sm ring-1 ring-border/70 sm:h-16 sm:w-16">
          <Image
            src="/00.png"
            alt="All In One POS logo"
            width={128}
            height={128}
            priority
            className="h-full w-full rounded-xl object-contain object-center"
          />
        </div>
        <span className="text-2xl font-semibold tracking-tight sm:text-[2rem]">All In One POS</span>
      </div>
      <LoginForm />
    </div>
  );
}
