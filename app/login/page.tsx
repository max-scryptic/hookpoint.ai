import { LoginForm } from "@/components/login-form"
import Image from "next/image"
import Link from "next/link"

export default function LoginPage() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted p-6 md:p-10">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <Link href="/" className="flex items-center gap-2 self-center font-medium">
          <div className="flex size-6 items-center justify-center overflow-hidden rounded-md bg-black">
            <Image
              src="/brand/hookpoint-logo-on-black.png"
              alt=""
              width={64}
              height={64}
              className="size-full scale-[1.7] object-cover"
              priority
            />
          </div>
          Hookpoint.ai
        </Link>
        <LoginForm mode="login" />
      </div>
    </div>
  )
}
