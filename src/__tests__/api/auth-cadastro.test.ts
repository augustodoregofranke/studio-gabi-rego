import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/auth/cadastro/route'

const { prismaMock, hashMock, randomBytesMock, resendMock, validarEmailMock } = vi.hoisted(() => ({
  prismaMock: {
    usuario: {
      findUnique: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
  },
  hashMock: vi.fn(),
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

vi.mock('bcryptjs', () => ({
  hash: hashMock,
}))

vi.mock('crypto', () => ({
  randomBytes: randomBytesMock,
}))

vi.mock('@/lib/resend', () => resendMock)

vi.mock('@/lib/validators', () => ({
  validarEmail: validarEmailMock,
}))

describe('Auth Cadastro API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const createRequest = (body: Record<string, unknown>) =>
    new NextRequest('http://localhost:3000/api/auth/cadastro', {
      method: 'POST',
      body: JSON.stringify(body),
    })

  it('returns 400 for invalid email', async () => {
    validarEmailMock.mockReturnValueOnce(false)

    const res = await POST(createRequest({ email: 'bad', senha: 'Senha123' }))
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error).toContain('Email inválido')
  })

  it('returns 400 for weak password', async () => {
    validarEmailMock.mockReturnValueOnce(true)

    const res = await POST(createRequest({ email: 'user@example.com', senha: 'senha123' }))
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error).toContain('letra maiúscula')
  })

  it('returns 400 when email already verified and complete', async () => {
    validarEmailMock.mockReturnValueOnce(true)
    prismaMock.usuario.findUnique.mockResolvedValueOnce({
      id: 'u-1',
      emailVerificado: new Date(),
      onboardingCompleto: true,
      membro: { id: 'm-1' },
      nome: 'Aluno',
    })

    const res = await POST(createRequest({ email: 'user@example.com', senha: 'Senha123' }))
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error).toContain('já está cadastrado')
  })

  it('sends completion email when email verified but onboarding incomplete', async () => {
    validarEmailMock.mockReturnValueOnce(true)
    prismaMock.usuario.findUnique.mockResolvedValueOnce({
      id: 'u-1',
      emailVerificado: new Date(),
      onboardingCompleto: false,
      membro: null,
      nome: 'Aluno',
    })
    randomBytesMock.mockReturnValueOnce(Buffer.from('profile'))
    resendMock.isResendConfigured.mockReturnValueOnce(true)
    resendMock.enviarEmail.mockResolvedValueOnce({ success: true })

    const res = await POST(createRequest({ email: 'user@example.com', senha: 'Senha123' }))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(prismaMock.usuario.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'u-1' },
        data: expect.objectContaining({ tokenReset: '70726f66696c65' }),
      })
    )
    expect(resendMock.enviarEmail).toHaveBeenCalled()
    expect(json.nextStep).toBe('complete-profile')
  })

  it('creates new user and sends verification email', async () => {
    validarEmailMock.mockReturnValueOnce(true)
    prismaMock.usuario.findUnique.mockResolvedValueOnce(null)
    randomBytesMock.mockReturnValueOnce(Buffer.from('verify'))
    hashMock.mockResolvedValueOnce('hashed')
    resendMock.isResendConfigured.mockReturnValueOnce(true)
    resendMock.enviarEmail.mockResolvedValueOnce({ success: true })

    const res = await POST(createRequest({ email: 'user@example.com', senha: 'Senha123' }))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(prismaMock.usuario.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ email: 'user@example.com', senha: 'hashed' }),
      })
    )
    expect(resendMock.enviarEmail).toHaveBeenCalled()
    expect(json.success).toBe(true)
  })

  it('returns 500 when email service not configured', async () => {
    validarEmailMock.mockReturnValueOnce(true)
    prismaMock.usuario.findUnique.mockResolvedValueOnce(null)
    randomBytesMock.mockReturnValueOnce(Buffer.from('verify'))
    hashMock.mockResolvedValueOnce('hashed')
    resendMock.isResendConfigured.mockReturnValueOnce(false)

    const res = await POST(createRequest({ email: 'user@example.com', senha: 'Senha123' }))
    const json = await res.json()

    expect(res.status).toBe(500)
    expect(json.error).toContain('Serviço de email não configurado')
  })
})
