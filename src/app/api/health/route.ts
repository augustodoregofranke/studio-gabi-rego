import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

/**
 * Health check endpoint for Docker/Kubernetes/Load Balancer
 * GET /api/health
 */
export async function GET() {
  try {
    // Check database connectivity
    await prisma.$queryRaw`SELECT 1`

    return NextResponse.json(
      {
        status: "healthy",
        timestamp: new Date().toISOString(),
        services: {
          database: "connected",
          app: "running",
        },
      },
      { status: 200 }
    )
  } catch (error) {
    console.error("Health check failed:", error)
    const includeErrorDetails = process.env.NODE_ENV !== "production"

    return NextResponse.json(
      {
        status: "unhealthy",
        timestamp: new Date().toISOString(),
        services: {
          database: "disconnected",
          app: "running",
        },
        error: includeErrorDetails && error instanceof Error ? error.message : "Erro interno",
      },
      { status: 503 }
    )
  }
}
