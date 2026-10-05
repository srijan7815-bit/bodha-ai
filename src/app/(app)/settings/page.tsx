'use client'

import { useAuth } from '@/components/AuthProvider'
import AppShell from '@/components/AppShell'
import SettingsView from '@/components/SettingsView'

/**
 * /settings — account, voice, and the student's own model endpoint.
 */
export default function SettingsPage() {
  const { user } = useAuth()
  if (!user) return null

  return (
    <AppShell>
      <div className="flex h-full min-h-0 flex-col">
        <SettingsView />
      </div>
    </AppShell>
  )
}
