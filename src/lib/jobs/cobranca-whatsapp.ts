import { prisma } from '@/lib/prisma'
import { addDaysYmd, formatBrFromYmd, getYmdInTimeZone } from '@/lib/dates'
import { formatarMoeda } from '@/lib/validators'
import { formatWhatsappNumber, sendWhatsappText } from '@/lib/whatsapp/evolution'
import { Prisma, TipoNotificacao } from '@prisma/client'

const DEFAULT_TIMEZONE = 'America/Sao_Paulo'
const DEFAULT_COUNTRY_CODE = '55'

function getAppTimezone() {
  return process.env.APP_TIMEZONE || DEFAULT_TIMEZONE
}

function getCountryCode() {
  return process.env.WHATSAPP_COUNTRY_CODE || DEFAULT_COUNTRY_CODE
}

type JobSummary = {
  targetDate: string
  candidates: number
  sent: number
  skipped: number
  failed: number
}

type PagamentoWithMembro = Prisma.PagamentoGetPayload<{
  include: {
    membro: {
      select: {
        id: true
        status: true
        telefone: true
        usuario: {
          select: {
            nome: true
          }
        }
      }
    }
  }
}>

function buildMensagem(
  nome: string,
  pagamentos: PagamentoWithMembro[],
  vencimento: string
) {
  if (pagamentos.length === 1) {
    const valor = formatarMoeda(Number(pagamentos[0].valor))
    return `Olá, ${nome}! Lembrete: seu pagamento de ${valor} vence amanhã (${vencimento}). Se já realizou o pagamento, desconsidere.`
  }

  const total = pagamentos.reduce((sum, pagamento) => sum + Number(pagamento.valor), 0)
  const valorTotal = formatarMoeda(total)
  return `Olá, ${nome}! Você tem ${pagamentos.length} pagamentos com vencimento amanhã (${vencimento}). Total: ${valorTotal}. Se já realizou o pagamento, desconsidere.`
}

export async function runCobrancaWhatsappT1(): Promise<JobSummary> {
  const todayYmd = getYmdInTimeZone(new Date(), getAppTimezone())
  const targetYmd = addDaysYmd(todayYmd, 1)
  const targetDate = new Date(`${targetYmd}T12:00:00.000Z`)
  const targetDateStart = new Date(`${targetYmd}T00:00:00.000Z`)
  const targetDateEnd = new Date(`${targetYmd}T23:59:59.999Z`)

  const pagamentos = await prisma.pagamento.findMany({
    where: {
      status: 'PENDENTE',
      dataVencimento: { gte: targetDateStart, lte: targetDateEnd },
      membro: {
        is: {
          status: 'ATIVO',
          telefone: { not: null },
        },
      },
    },
    include: {
      membro: {
        select: {
          id: true,
          status: true,
          telefone: true,
          usuario: {
            select: { nome: true },
          },
        },
      },
    },
  })

  const grouped = new Map<string, PagamentoWithMembro[]>()
  for (const pagamento of pagamentos) {
    if (!pagamento.membro) {
      continue
    }
    const key = pagamento.membro.id
    const current = grouped.get(key) ?? []
    current.push(pagamento)
    grouped.set(key, current)
  }

  const summary: JobSummary = {
    targetDate: targetYmd,
    candidates: grouped.size,
    sent: 0,
    skipped: 0,
    failed: 0,
  }

  const vencimento = formatBrFromYmd(targetYmd)

  for (const [membroId, items] of grouped.entries()) {
    const membro = items[0]?.membro
    if (!membro) {
      summary.skipped += 1
      continue
    }
    const nome = membro.usuario?.nome || 'Aluno(a)'
    const telefone = membro.telefone || ''
    const numero = formatWhatsappNumber(telefone, getCountryCode())

    if (!numero) {
      summary.skipped += 1
      continue
    }

    const mensagem = buildMensagem(nome, items, vencimento)
    const titulo = 'Lembrete de Pagamento'
    const existingNotificacao = await prisma.notificacao.findFirst({
      where: {
        membroId,
        tipo: TipoNotificacao.COBRANCA,
        canalWhatsapp: true,
        agendadaPara: targetDate,
      },
      select: { id: true, enviada: true },
    })

    const notificacao = existingNotificacao
      ? await prisma.notificacao.update({
          where: { id: existingNotificacao.id },
          data: {
            titulo,
            mensagem,
            canalWhatsapp: true,
            agendadaPara: targetDate,
          },
          select: { id: true, enviada: true },
        })
      : await prisma.notificacao.create({
          data: {
            membroId,
            tipo: TipoNotificacao.COBRANCA,
            titulo,
            mensagem,
            canalWhatsapp: true,
            canalEmail: false,
            agendadaPara: targetDate,
          },
          select: { id: true, enviada: true },
        })

    if (notificacao.enviada) {
      summary.skipped += 1
      continue
    }

    try {
      await sendWhatsappText({ to: numero, text: mensagem })
      await prisma.notificacao.update({
        where: { id: notificacao.id },
        data: {
          enviada: true,
          enviadaEm: new Date(),
        },
      })
      summary.sent += 1
    } catch {
      summary.failed += 1
    }
  }

  return summary
}
