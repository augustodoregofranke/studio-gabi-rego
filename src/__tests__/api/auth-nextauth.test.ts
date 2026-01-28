import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', () => ({
  handlers: {
    GET: vi.fn(),
    POST: vi.fn(),
  },
}))
import { GET, POST, runtime } from '@/app/api/auth/[...nextauth]/route'

describe('Auth NextAuth route exports', () => {
  it('exports GET and POST handlers', () => {
    expect(typeof GET).toBe('function')
    expect(typeof POST).toBe('function')
  })

  it('forces nodejs runtime', () => {
    expect(runtime).toBe('nodejs')
  })
})
