import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/auth/verificar-email/route'

const { prismaMock, randomBytesMock } = vi.hoisted(() => ({
  prismaMock: {
    usuario: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
  randomBytesMock: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}))

vi.mock('crypto', () => ({
  randomBytes: randomBytesMock,
}))

describe('Auth Verificar Email API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const createRequest = (body: Record<string, unknown>) =>
    new NextRequest('http://localhost:3000/api/auth/verificar-email', {
      method: 'POST',
      body: JSON.stringify(body),
    })

  it('returns 400 when token missing', async () => {
    const res = await POST(createRequest({}))
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error).toContain('Token não fornecido')
  })

  it('returns 400 when token invalid', async () => {
    prismaMock.usuario.findUnique.mockResolvedValueOnce(null)

    const res = await POST(createRequest({ token: 'bad' }))
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error).toContain('Token inválido')
  })

  it('returns 400 when token expired', async () => {
    prismaMock.usuario.findUnique.mockResolvedValueOnce({
      id: 'u-1',
      email: 'user@example.com',
      tokenVerificacaoExpira: new Date(Date.now() - 1000),
    })

    const res = await POST(createRequest({ token: 'expired' }))
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error).toContain('Token expirado')
  })

  it('sets admin role when studio domain', async () => {
    prismaMock.usuario.findUnique.mockResolvedValueOnce({
      id: 'u-1',
      email: 'admin@studiogabirego.com',
      tokenVerificacaoExpira: new Date(Date.now() + 1000),
    })

    const res = await POST(createRequest({ token: 'token' }))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(prismaMock.usuario.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'u-1' },
        data: expect.objectContaining({ role: 'ADMIN', onboardingCompleto: true }),
      })
    )
    expect(json.isAdmin).toBe(true)
  })

  it('returns profile token for regular members', async () => {
    prismaMock.usuario.findUnique.mockResolvedValueOnce({
      id: 'u-2',
      email: 'user@example.com',
      tokenVerificacaoExpira: new Date(Date.now() + 1000),
    })
    randomBytesMock.mockReturnValueOnce(Buffer.from('profile'))

    const res = await POST(createRequest({ token: 'token' }))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(prismaMock.usuario.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'u-2' },
        data: expect.objectContaining({ etapaOnboarding: 2 }),
      })
    )
    expect(json.profileToken).toBe('70726f66696c65')
    expect(json.isAdmin).toBe(false)
  })
})
