import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/auth'
import AuthForm from '@/components/AuthForm'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Create your account · BODHA AI' }

export default async function RegisterPage() {
  const user = await getSessionUser()
  if (user) redirect('/chat')
  return <AuthForm mode="register" />
}
