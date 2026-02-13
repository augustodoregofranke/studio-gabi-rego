import PDFDocument from 'pdfkit'
import fs from 'fs'
import path from 'path'
import { FREE_STYLE_SCRIPT_TTF_BASE64 } from '@/lib/fonts/FreeStyleScript.base64'
import type { TrainingPDFData, TrainingPDFExercise } from '@/domain/treino'

// A4 Dimensions (PDFKit defaults to 72 DPI, but can accept other units or we convert)
// PDFKit default is points. 1 cm = 28.3465 points
const CM = 28.3465
const PAGE_WIDTH = 595.28  // A4 width in points
const PAGE_HEIGHT = 841.89 // A4 height in points
const MARGIN_LEFT = 1.5 * CM
const MARGIN_RIGHT = 1.5 * CM
const MARGIN_TOP = 1.5 * CM
const MARGIN_BOTTOM = 1.5 * CM
const PAGE_BORDER_MARGIN = 0.5 * CM
const PAGE_BORDER_LINE_WIDTH = 0.5
const USABLE_WIDTH = PAGE_WIDTH - MARGIN_LEFT - MARGIN_RIGHT

// Table dimensions (smaller and centered)
const TABLE_WIDTH_RATIO = 0.95 // Table takes 95% of usable width
const TABLE_MARGIN = (USABLE_WIDTH - USABLE_WIDTH * TABLE_WIDTH_RATIO) / 2
const TABLE_LEFT = MARGIN_LEFT + TABLE_MARGIN
const TABLE_WIDTH = USABLE_WIDTH * TABLE_WIDTH_RATIO

// Fonts
const FONT_REGULAR_FALLBACK = 'Helvetica'
const FONT_BOLD_FALLBACK = 'Helvetica-Bold'
const SCRIPT_FONT_NAME = 'FreeStyleScript'

const EXTRA_ROWS = 3


function getLogoPath(): string | null {
  const possiblePaths = [
    path.join(process.cwd(), 'public', 'logo-black.png'),
    path.join(__dirname, '..', '..', 'public', 'logo-black.png'),
  ]

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      return p
    }
  }
  return null
}

function drawPageBorder(doc: PDFKit.PDFDocument): void {
  doc.save()
  doc.lineWidth(PAGE_BORDER_LINE_WIDTH)
  doc.rect(
    PAGE_BORDER_MARGIN,
    PAGE_BORDER_MARGIN,
    PAGE_WIDTH - PAGE_BORDER_MARGIN * 2,
    PAGE_HEIGHT - PAGE_BORDER_MARGIN * 2
  ).stroke()
  doc.restore()
}

function createTableDrawer(options: {
  doc: PDFKit.PDFDocument
  fontRegular: string
  fontBold: string
}) {
  const { doc, fontRegular, fontBold } = options
  const colWidths = [
    TABLE_WIDTH * 0.45, // Exercise
    TABLE_WIDTH * 0.12, // Sets
    TABLE_WIDTH * 0.13, // Reps
    TABLE_WIDTH * 0.30, // Notes
  ]
  const rowHeight = 0.5 * CM

  const drawRow = (y: number, cols: string[], isHeader: boolean = false) => {
    let x = TABLE_LEFT

    cols.forEach((text, i) => {
      const width = colWidths[i]

      // Draw cell border
      doc.rect(x, y, width, rowHeight).stroke()

      // Draw text
      doc.font(isHeader ? fontBold : fontRegular)
        .fontSize(10)

      const textX = x + 2
      const textY = y + (rowHeight - 10) / 2 + 2
      const align = i > 0 ? 'center' as const : 'left' as const
      const textOptions = {
        width: width - 4,
        align,
        lineBreak: false,
        ellipsis: true,
      }

      doc.text(text, textX, textY, textOptions)
      if (isHeader) {
        // Simulate bold by drawing twice with a slight offset.
        doc.text(text, textX + 0.5, textY, textOptions)
      }

      x += width
    })
  }

  const drawTable = (params: {
    title: string
    exercises: TrainingPDFExercise[]
    cursorY: number
  }) => {
    const { title, exercises } = params
    let cursorY = params.cursorY

    // Check for page break
    if (cursorY + 3 * CM > PAGE_HEIGHT - MARGIN_BOTTOM) {
      doc.addPage()
      cursorY = MARGIN_TOP
    }

    // Title
    doc.font(fontBold).fontSize(18)
    doc.text(title, MARGIN_LEFT, cursorY)
    cursorY += 1 * CM

    // Check space for whole table or at least header + 1 row
    const totalTableHeight = (exercises.length + EXTRA_ROWS + 1) * rowHeight
    if (cursorY + totalTableHeight > PAGE_HEIGHT - MARGIN_BOTTOM) {
      if (cursorY > MARGIN_TOP + 5 * CM) {
        doc.addPage()
        cursorY = MARGIN_TOP
        doc.font(fontBold).fontSize(18)
        doc.text(`${title} (cont.)`, MARGIN_LEFT, cursorY)
        cursorY += 1 * CM
      }
    }

    // Header
    drawRow(cursorY, ['EXERCÍCIOS', 'SÉRIES', 'REPETIÇÕES', ''], true)
    cursorY += rowHeight

    // Rows
    exercises.forEach((ex) => {
      drawRow(cursorY, [
        ex.name.toUpperCase(),
        ex.sets.toUpperCase(),
        ex.reps.toUpperCase(),
        ex.observacoes?.toUpperCase() || ''
      ])
      cursorY += rowHeight
    })

    // Extra Rows
    for (let i = 0; i < EXTRA_ROWS; i++) {
      drawRow(cursorY, ['', '', '', ''])
      cursorY += rowHeight
    }

    cursorY += 1 * CM // Spacing after table

    return cursorY
  }

  return { drawTable }
}

export async function generateTrainingPDF(data: TrainingPDFData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 0, // We handle margins manually
      autoFirstPage: true,
      info: {
        Title: `Ficha de Treino - ${data.aluno}`,
      }
    })

    let fontRegular = SCRIPT_FONT_NAME
    let fontBold = SCRIPT_FONT_NAME

    try {
      // Embed font for serverless environments (no filesystem dependency).
      const scriptFontBuffer = Buffer.from(FREE_STYLE_SCRIPT_TTF_BASE64, 'base64')
      doc.registerFont(SCRIPT_FONT_NAME, scriptFontBuffer)
    } catch (err) {
      console.warn('FreeStyleScript font load failed; falling back to Helvetica.', err)
      fontRegular = FONT_REGULAR_FALLBACK
      fontBold = FONT_BOLD_FALLBACK
    }

    const buffers: Buffer[] = []

    doc.on('data', buffers.push.bind(buffers))
    doc.on('end', () => resolve(Buffer.concat(buffers)))
    doc.on('error', reject)
    doc.on('pageAdded', () => {
      drawPageBorder(doc)
    })

    drawPageBorder(doc)

    let cursorY = MARGIN_TOP

    // 1. HEADER & LOGO
    const logoPath = getLogoPath()
    const logoSize = 5 * CM

    if (logoPath) {
      doc.image(logoPath, MARGIN_LEFT, cursorY, {
        width: logoSize,
        height: logoSize,
        fit: [logoSize, logoSize],
        align: 'center',
        valign: 'center'
      })
    }

    // Text Header (Next to Logo)
    const textStartX = MARGIN_LEFT + logoSize + 1 * CM
    
    // Calculate Y to center text vertically relative to logo, or match Python fixed offsets
    // Python: logo at top-left. Text started relative to logo.
    // Let's align roughly with Python script:
    // Python: Aluno line at `cursor_y - 2*cm` (relative to top of page content area)
    
    // Aluno
    let textY = MARGIN_TOP + 1.5 * CM
    doc.font(fontBold).fontSize(20)
    doc.text('ALUNO:', textStartX, textY, { continued: true })
    doc.font(fontRegular).text(`  ${data.aluno}`)
    
    // Underline Aluno
    doc.moveTo(textStartX + 2.3 * CM, textY + 22) // Approx underline position
       .lineTo(PAGE_WIDTH - MARGIN_RIGHT, textY + 22)
       .stroke()

    // Data
    textY += 1.5 * CM
    doc.font(fontBold).text('DATA:', textStartX, textY, { continued: true })
    doc.font(fontRegular).text(`  ${data.date}`)

    // Underline Data
    doc.moveTo(textStartX + 2.3 * CM, textY + 22)
       .lineTo(PAGE_WIDTH - MARGIN_RIGHT, textY + 22)
       .stroke()

    // Move cursor below header
    cursorY = MARGIN_TOP + logoSize + 1 * CM

    const tableDrawer = createTableDrawer({ doc, fontRegular, fontBold })

    // 2. WORKOUT TABLES
    data.sessions.forEach((session) => {
      if (session.exercises && session.exercises.length > 0) {
        cursorY = tableDrawer.drawTable({
          title: `TREINO ${session.name}`,
          exercises: session.exercises,
          cursorY,
        })
      }
    })

    // 3. OBSERVATIONS
    if (data.observacoes && data.observacoes.trim()) {
      if (cursorY + 2 * CM > PAGE_HEIGHT - MARGIN_BOTTOM) {
        doc.addPage()
        cursorY = MARGIN_TOP
      }

      doc.font(fontBold).fontSize(12)
      doc.text('OBSERVAÇÕES:', MARGIN_LEFT, cursorY)
      
      doc.font(fontRegular).fontSize(12)
      doc.text(data.observacoes.trim().toUpperCase(), MARGIN_LEFT + 100, cursorY, { // Offset text
        width: USABLE_WIDTH - 100,
        align: 'left'
      })
    }

    doc.end()
  })
}
