import * as React from "react"
import { HeadFC } from "gatsby";

export default function getPageTitle(title: string): HeadFC {
  const PageTitle: HeadFC = () => <title>{title} | LYF Registration</title>
  return PageTitle
}