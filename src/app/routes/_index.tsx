import type { MetaFunction } from "react-router";
import { useLoaderData } from "react-router";
import Welcome from "../features/welcome/welcome";

export async function loader() {
  const streamingEndpoint = process.env.LLM_STREAM_URL;
  if (!streamingEndpoint) {
    throw new Error("LLM_STREAM_URL environment variable is required");
  }
  const mcpProxyEndpoint = process.env.MCP_PROXY_ENDPOINT ?? null;
  return {
    streamingEndpoint,
    mcpProxyEndpoint,
  };
}

const DESCRIPTION =
  "Personal site of Archil Lelashvili, software engineer at Amazon Robotics building agentic AI systems and full-stack web applications. Ask the AI assistant anything.";

const JSON_LD = JSON.stringify({
  "@context": "https://schema.org",
  "@type": "Person",
  name: "Archil Lelashvili",
  jobTitle: "Software Engineer",
  worksFor: { "@type": "Organization", name: "Amazon Robotics" },
  url: "https://ask.archil.io",
  sameAs: [
    "https://www.linkedin.com/in/archil-l",
    "https://github.com/archil-l/ask-archil-io",
  ],
});

export const meta: MetaFunction = () => [
  { title: "Archil Lelashvili – Software Engineer & AI Builder" },
  { name: "description", content: DESCRIPTION },
  { name: "robots", content: "index, follow" },
  { tagName: "link", rel: "canonical", href: "https://ask.archil.io" },
  { property: "og:type", content: "website" },
  { property: "og:url", content: "https://ask.archil.io" },
  {
    property: "og:title",
    content: "Archil Lelashvili – Software Engineer & AI Builder",
  },
  { property: "og:description", content: DESCRIPTION },
  { property: "og:image", content: "https://ask.archil.io/profile-pic-og.png" },
  { name: "twitter:card", content: "summary_large_image" },
  {
    name: "twitter:title",
    content: "Archil Lelashvili – Software Engineer & AI Builder",
  },
  { name: "twitter:description", content: DESCRIPTION },
  {
    name: "twitter:image",
    content: "https://ask.archil.io/profile-pic-og.png",
  },
];

export default function Index() {
  const { streamingEndpoint, mcpProxyEndpoint } =
    useLoaderData<typeof loader>();
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON_LD }}
      />
      <noscript>
        <h1>Archil Lelashvili – Software Engineer</h1>
        <p>
          Software engineer at Amazon Robotics building agentic AI systems and
          full-stack web applications. Ask the AI assistant anything about my
          work, projects, and engineering journey.
        </p>
        <p>Experience · How this page is built · Contact</p>
      </noscript>
      <Welcome
        streamingEndpoint={streamingEndpoint}
        mcpProxyEndpoint={mcpProxyEndpoint}
      />
    </>
  );
}
