"use client"

import { useState, useEffect, Suspense, useSyncExternalStore } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useSession } from "next-auth/react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ThemeToggleSimple } from "@/components/theme-toggle"
import { ArrowRight, User } from "lucide-react"
import Image from "next/image"

const PROFILE_TOKEN_STORAGE_KEY = "onboarding_profile_token"
const ANAMNESE_TOKEN_STORAGE_KEY = "onboarding_anamnese_token"

function CompletarPerfilContent() {
  const { status } = useSession()
  const searchParams = useSearchParams()
  const tokenFromUrl = searchParams.get("token")
  const profileTokenFromStorage = useSyncExternalStore(
    () => () => {},
    () => {
      if (typeof window === "undefined") return null
      try {
        return localStorage.getItem(PROFILE_TOKEN_STORAGE_KEY)
      } catch {
        return null
      }
    },
    () => null
  )
  const profileToken = status === "authenticated"
    ? null
    : (tokenFromUrl ?? profileTokenFromStorage)
  const [isLoading, setIsLoading] = useState(false)
  const [cpf, setCpf] = useState("")
  const [telefone, setTelefone] = useState("")
  const router = useRouter()

  useEffect(() => {
    if (tokenFromUrl) {
      try {
        localStorage.setItem(PROFILE_TOKEN_STORAGE_KEY, tokenFromUrl)
      } catch {
        // Ignore storage errors (private mode / blocked storage)
      }
      return
    }

    if (status === "authenticated") {
      try {
        localStorage.removeItem(PROFILE_TOKEN_STORAGE_KEY)
      } catch {
        // Ignore storage errors (private mode / blocked storage)
      }
    }
  }, [tokenFromUrl, status])

  // Redirect if not authenticated AND no profile token
  useEffect(() => {
    if (status === "loading") {
      return
    }
    if (status === "unauthenticated" && !profileToken) {
      router.push("/login")
    }
  }, [status, profileToken, router])

  // Format CPF as user types
  function handleCpfChange(value: string) {
    const numbers = value.replace(/\D/g, "")
    let formatted = numbers
    if (numbers.length > 3) {
      formatted = numbers.slice(0, 3) + "." + numbers.slice(3)
    }
    if (numbers.length > 6) {
      formatted = formatted.slice(0, 7) + "." + numbers.slice(6)
    }
    if (numbers.length > 9) {
      formatted = formatted.slice(0, 11) + "-" + numbers.slice(9, 11)
    }
    setCpf(formatted)
  }

  // Format phone as user types
  function handleTelefoneChange(value: string) {
    const numbers = value.replace(/\D/g, "")
    let formatted = numbers
    if (numbers.length > 0) {
      formatted = "(" + numbers.slice(0, 2)
    }
    if (numbers.length > 2) {
      formatted += ") " + numbers.slice(2, 7)
    }
    if (numbers.length > 7) {
      formatted += "-" + numbers.slice(7, 11)
    }
    setTelefone(formatted)
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsLoading(true)

    const formData = new FormData(event.currentTarget)
    const nome = formData.get("nome") as string
    const sexo = (formData.get("sexo") as string) || ""
    const dataNascimento = (formData.get("dataNascimento") as string) || ""
    const rg = (formData.get("rg") as string) || ""

    // Validate CPF format (basic check)
    const cpfNumbers = cpf.replace(/\D/g, "")
    if (cpfNumbers.length > 0 && cpfNumbers.length !== 11) {
      toast.error("CPF inválido")
      setIsLoading(false)
      return
    }

    // Validate phone
    const telefoneNumbers = telefone.replace(/\D/g, "")
    if (telefoneNumbers.length > 0 && telefoneNumbers.length < 10) {
      toast.error("Telefone inválido")
      setIsLoading(false)
      return
    }

    if (dataNascimento) {
      const birthDate = new Date(dataNascimento)
      if (Number.isNaN(birthDate.getTime())) {
        toast.error("Data de nascimento inválida")
        setIsLoading(false)
        return
      }

      // Validate age (minimum 16 years) only when provided
      const today = new Date()
      let age = today.getFullYear() - birthDate.getFullYear()
      const monthDiff = today.getMonth() - birthDate.getMonth()
      if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
        age--
      }
      if (age < 16) {
        toast.error("Você precisa ter pelo menos 16 anos")
        setIsLoading(false)
        return
      }
    }

    try {
      const response = await fetch("/api/perfil", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: profileToken, // Pass profile token for unauthenticated flow
          nome,
          cpf: cpfNumbers.length > 0 ? cpfNumbers : null,
          rg: rg.trim() !== "" ? rg : null,
          telefone: telefoneNumbers.length > 0 ? telefoneNumbers : null,
          dataNascimento: dataNascimento.trim() !== "" ? dataNascimento : null,
          sexo: sexo.trim() !== "" ? sexo : null,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        toast.error(data.error || "Erro ao salvar perfil")
        setIsLoading(false)
        return
      }

      toast.success("Perfil salvo com sucesso!")
      const anamneseUrl = profileToken && data.anamneseToken
        ? `/anamnese?token=${encodeURIComponent(data.anamneseToken)}`
        : "/anamnese"
      if (profileToken && data.anamneseToken) {
        try {
          localStorage.setItem(ANAMNESE_TOKEN_STORAGE_KEY, data.anamneseToken)
          localStorage.removeItem(PROFILE_TOKEN_STORAGE_KEY)
        } catch {
          // Ignore storage errors (private mode / blocked storage)
        }
      }
      router.push(anamneseUrl)
    } catch (error) {
      toast.error("Ocorreu um erro ao salvar o perfil")
      console.error(error)
      setIsLoading(false)
    }
  }

  // Show loading only when checking session and no token
  if (status === "loading" && !profileToken) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-spin h-8 w-8 border-4 border-orange-500 border-t-transparent rounded-full" />
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden bg-background completar-perfil-page">
      {/* Background decorations */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-1/3 -right-1/4 w-[600px] h-[600px] rounded-full bg-gradient-to-br from-orange-500/30 to-orange-600/10 blur-3xl animate-pulse" />
        <div className="absolute -bottom-1/4 -left-1/4 w-[500px] h-[500px] rounded-full bg-gradient-to-tr from-orange-600/25 to-amber-500/10 blur-3xl" />
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-orange-500/50 to-transparent" />
        <div className="absolute bottom-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-orange-600/30 to-transparent" />
      </div>

      {/* Theme toggle */}
      <div className="absolute top-4 right-4 z-20">
        <ThemeToggleSimple />
      </div>

      <Card className="w-full max-w-md relative z-10 border-orange-500/20 shadow-2xl shadow-orange-900/20 dark:shadow-orange-500/10 gap-0 backdrop-blur-sm bg-card/95">
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-orange-600 via-orange-500 to-amber-500 rounded-t-xl" />

        <CardHeader className="text-center pb-4 pt-6">
          <div className="flex justify-center mb-4">
            <Image
              src="/logo.png"
              alt="Gabi Studio"
              width={150}
              height={150}
              className="object-contain"
              priority
            />
          </div>

          {/* Progress indicator */}
          <div className="flex items-center justify-center gap-2 mb-3">
            <div className="w-8 h-8 rounded-full bg-orange-500 text-white flex items-center justify-center text-sm font-bold">3</div>
            <span className="text-xs text-orange-500 font-medium">Perfil</span>
          </div>

          <div className="flex justify-center mb-2">
            <div className="w-16 h-16 rounded-full bg-orange-500/10 flex items-center justify-center">
              <User className="h-8 w-8 text-orange-500" />
            </div>
          </div>

          <CardDescription className="text-foreground font-medium text-lg">
            Complete seu perfil
          </CardDescription>
          <CardDescription className="text-muted-foreground mt-1">
            Precisamos de algumas informações para finalizar
          </CardDescription>
        </CardHeader>

        <CardContent className="pt-0 pb-6">
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="nome" className="text-sm font-medium flex items-center gap-1.5">
                <span className="w-1 h-1 rounded-full bg-orange-500" />
                Nome completo *
              </Label>
              <Input
                id="nome"
                name="nome"
                type="text"
                placeholder="Seu nome completo"
                required
                minLength={3}
                disabled={isLoading}
                className="h-12 border-orange-500/20 focus:border-orange-500 focus:ring-orange-500/20 bg-background/50"
              />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="cpf" className="text-sm font-medium flex items-center gap-1.5">
                  <span className="w-1 h-1 rounded-full bg-muted-foreground" />
                  CPF
                </Label>
                <Input
                  id="cpf"
                  name="cpf"
                  type="text"
                  inputMode="numeric"
                  placeholder="000.000.000-00"
                  disabled={isLoading}
                  value={cpf}
                  onChange={(e) => handleCpfChange(e.target.value)}
                  maxLength={14}
                  className="h-12 border-orange-500/20 focus:border-orange-500 focus:ring-orange-500/20 bg-background/50"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="rg" className="text-sm font-medium flex items-center gap-1.5">
                  <span className="w-1 h-1 rounded-full bg-muted-foreground" />
                  RG
                </Label>
                <Input
                  id="rg"
                  name="rg"
                  type="text"
                  placeholder="Opcional"
                  disabled={isLoading}
                  className="h-12 border-orange-500/20 focus:border-orange-500 focus:ring-orange-500/20 bg-background/50"
                />
              </div>
            </div>

            <div className="space-y-1.5">
                <Label htmlFor="telefone" className="text-sm font-medium flex items-center gap-1.5">
                  <span className="w-1 h-1 rounded-full bg-muted-foreground" />
                  Telefone / WhatsApp
                </Label>
              <Input
                id="telefone"
                name="telefone"
                type="tel"
                inputMode="tel"
                placeholder="(00) 00000-0000"
                  disabled={isLoading}
                  value={telefone}
                  onChange={(e) => handleTelefoneChange(e.target.value)}
                  maxLength={15}
                  className="h-12 border-orange-500/20 focus:border-orange-500 focus:ring-orange-500/20 bg-background/50"
              />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5 min-w-0 overflow-hidden completar-perfil-date-field">
                <Label htmlFor="dataNascimento" className="text-sm font-medium flex items-center gap-1.5">
                  <span className="w-1 h-1 rounded-full bg-muted-foreground" />
                  Data de nascimento
                </Label>
                <Input
                  id="dataNascimento"
                  name="dataNascimento"
                  type="date"
                  disabled={isLoading}
                  className="h-12 w-full min-w-0 max-w-full overflow-hidden border-orange-500/20 focus:border-orange-500 focus:ring-orange-500/20 bg-background/50 completar-perfil-date-input"
                />
              </div>

              <div className="space-y-1.5 min-w-0">
                <Label htmlFor="sexo" className="text-sm font-medium flex items-center gap-1.5">
                  <span className="w-1 h-1 rounded-full bg-muted-foreground" />
                  Sexo
                </Label>
                <Select name="sexo" disabled={isLoading}>
                  <SelectTrigger className="h-12 border-orange-500/20 focus:border-orange-500 focus:ring-orange-500/20 bg-background/50">
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="FEMININO">Feminino</SelectItem>
                    <SelectItem value="MASCULINO">Masculino</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <Button
              type="submit"
              className="w-full h-12 text-base font-semibold bg-gradient-to-r from-orange-600 via-orange-500 to-orange-600 hover:from-orange-500 hover:via-orange-400 hover:to-orange-500 shadow-lg shadow-orange-600/30 hover:shadow-orange-500/40 transition-all border-0 mt-2"
              disabled={isLoading}
            >
              {isLoading ? (
                <span className="flex items-center gap-2">
                  <span className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Salvando...
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  Continuar
                  <ArrowRight className="h-4 w-4" />
                </span>
              )}
            </Button>
          </form>

          {/* Divider */}
          <div className="flex items-center gap-3 mt-5">
            <div className="flex-1 h-px bg-gradient-to-r from-transparent via-orange-500/30 to-transparent" />
            <div className="flex-1 h-px bg-gradient-to-r from-transparent via-orange-500/30 to-transparent" />
          </div>

          <p className="text-xs text-center text-muted-foreground mt-4">
            Seus dados estão protegidos e serão usados apenas para o cadastro.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

export default function CompletarPerfilPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-spin h-8 w-8 border-4 border-orange-500 border-t-transparent rounded-full" />
      </div>
    }>
      <CompletarPerfilContent />
    </Suspense>
  )
}
