import { redirect } from "next/navigation"

type CustomerServicePageProps = {
  params: Promise<{
    countryCode: string
  }>
}

export default async function CustomerServicePage({
  params,
}: CustomerServicePageProps) {
  const { countryCode } = await params
  redirect(`/${countryCode}/support`)
}
