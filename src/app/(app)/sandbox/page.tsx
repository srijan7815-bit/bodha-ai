'use client'

import { useAuth } from '@/components/AuthProvider'
import AppShell from '@/components/AppShell'
import SandboxWorkbench from '@/components/SandboxWorkbench'

const STORAGE_KEY = 'bodha:sandbox-project'

/**
 * /sandbox — the full-page code workbench.
 */
export default function SandboxPage() {
  const { user } = useAuth()
  if (!user) return null

  return (
    <AppShell>
      <div className="flex h-full min-h-0 flex-col">
        <SandboxWorkbench storageKey={STORAGE_KEY} />
      </div>
    </AppShell>
  )
}