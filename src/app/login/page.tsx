import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/auth'
import AuthForm from '@/components/AuthForm'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Sign in · BODHA AI' }

export default async function LoginPage() {
  const user = await getSessionUser()
  if (user) redirect('/chat')
  return <AuthForm mode="login" />
}
