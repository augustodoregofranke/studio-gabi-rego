import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/auth/reenviar-verificacao/route'

const { prismaMock, randomBytesMock, resendMock, validarEmailMock } = vi.hoisted(() => ({
  prismaMock: {
    usuario: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
  randomBytesMock: vi.fn(),
  resendMock: {
    enviarEmail: vi.fn(),
    isResendConfigured: vi.fn(),
    emailTemplates: {
      completarPerfil: vi.fn(() => '<p>ok</p>'),
      verificacaoEmail: vi.fn(() => '<p>ok</p>'),
    },
  },
  validarEmailMock: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}))

vi.mock('crypto', () => ({
  randomBytes: randomBytesMock,
}))

vi.mock('@/lib/resend', () => resendMock)

vi.mock('@/lib/validators', () => ({
  validarEmail: validarEmailMock,
}))

describe('Auth Reenviar Verificacao API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const createRequest = (body: Record<string, unknown>) =>
    new NextRequest('http://localhost:3000/api/auth/reenviar-verificacao', {
      method: 'POST',
      body: JSON.stringify(body),
    })

  it('returns 400 for invalid email', async () => {
    validarEmailMock.mockReturnValueOnce(false)

    const res = await POST(createRequest({ email: 'bad' }))
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error).toContain('Email inválido')
  })

  it('returns success when user not found', async () => {
    validarEmailMock.mockReturnValueOnce(true)
    prismaMock.usuario.findUnique.mockResolvedValueOnce(null)

    const res = await POST(createRequest({ email: 'user@example.com' }))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
  })

  it('returns 400 when email already verified and onboarding complete', async () => {
    validarEmailMock.mockReturnValueOnce(true)
    prismaMock.usuario.findUnique.mockResolvedValueOnce({
      id: 'u-1',
      nome: 'Aluno',
      emailVerificado: new Date(),
      onboardingCompleto: true,
      membro: { id: 'm-1' },
    })

    const res = await POST(createRequest({ email: 'user@example.com' }))
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error).toContain('já foi verificado')
  })

  it('sends completion link when email verified but onboarding incomplete', async () => {
    validarEmailMock.mockReturnValueOnce(true)
    prismaMock.usuario.findUnique.mockResolvedValueOnce({
      id: 'u-1',
      nome: 'Aluno',
      emailVerificado: new Date(),
      onboardingCompleto: false,
      membro: null,
    })
    randomBytesMock.mockReturnValueOnce(Buffer.from('profile'))
    resendMock.isResendConfigured.mockReturnValueOnce(true)
    resendMock.enviarEmail.mockResolvedValueOnce({ success: true })

    const res = await POST(createRequest({ email: 'user@example.com' }))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(prismaMock.usuario.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'u-1' },
        data: expect.objectContaining({ etapaOnboarding: 2 }),
      })
    )
    expect(resendMock.enviarEmail).toHaveBeenCalled()
    expect(json.success).toBe(true)
  })

  it('sends verification link when email not verified', async () => {
    validarEmailMock.mockReturnValueOnce(true)
    prismaMock.usuario.findUnique.mockResolvedValueOnce({
      id: 'u-2',
      nome: 'Aluno',
      emailVerificado: null,
      onboardingCompleto: false,
      membro: null,
    })
    randomBytesMock.mockReturnValueOnce(Buffer.from('verify'))
    resendMock.isResendConfigured.mockReturnValueOnce(true)
    resendMock.enviarEmail.mockResolvedValueOnce({ success: true })

    const res = await POST(createRequest({ email: 'user@example.com' }))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(prismaMock.usuario.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'u-2' },
        data: expect.objectContaining({ tokenVerificacao: '766572696679' }),
      })
    )
    expect(resendMock.enviarEmail).toHaveBeenCalled()
    expect(json.success).toBe(true)
  })
})
