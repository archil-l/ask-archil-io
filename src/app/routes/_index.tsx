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
  alumniOf: [
    { "@type": "CollegeOrUniversity", name: "Northeastern University" },
    { "@type": "CollegeOrUniversity", name: "FH Technikum Wien" },
  ],
  knowsAbout: [
    "React",
    "TypeScript",
    "AWS",
    "Agentic AI",
    "Full-Stack Web Development",
    "MCP",
    "Node.js",
  ],
  sameAs: [
    "https://www.linkedin.com/in/archil-l",
    "https://github.com/archil-l",
    "https://github.com/archil-l/ask-archil-io",
  ],
});

export const meta: MetaFunction = () => [
  { title: "Archil Lelashvili – Software Engineer" },
  { name: "description", content: DESCRIPTION },
  { name: "robots", content: "index, follow" },
  { tagName: "link", rel: "canonical", href: "https://ask.archil.io" },
  { property: "og:type", content: "website" },
  { property: "og:url", content: "https://ask.archil.io" },
  {
    property: "og:title",
    content: "Archil Lelashvili – Software Engineer",
  },
  { property: "og:description", content: DESCRIPTION },
  { property: "og:image", content: "https://ask.archil.io/profile-pic-og.png" },
  { name: "twitter:card", content: "summary_large_image" },
  {
    name: "twitter:title",
    content: "Archil Lelashvili – Software Engineer",
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
        <h1>Archil Lelashvili – Software Engineer &amp; AI Builder</h1>
        <p>
          Software engineer with 5 years of experience building enterprise web
          applications. Currently at Amazon Robotics, developing agentic AI
          infrastructure and full-stack applications for robotic systems using
          React, TypeScript, and AWS.
        </p>

        <h2>Experience</h2>
        <h3>Software Dev Engineer II – Amazon Robotics (Jan 2025 – Present)</h3>
        <p>
          Architecting infrastructure-as-code for agentic AI systems including
          MCP servers, agents, knowledge bases, and memory management using AWS
          Bedrock, AgentCore, and the Strands framework. Building full-stack
          agentic web applications with React Router v7 and React 19.
        </p>

        <h3>Software Engineer II – Quickbase Inc. (Feb 2024 – Jan 2025)</h3>
        <p>
          Implemented WCAG 2.1 accessibility features and led a team of four
          engineering co-ops to deliver customer-facing features using React.
        </p>

        <h3>Software Engineer I – Quickbase Inc. (Jul 2022 – Jan 2024)</h3>
        <p>
          Developed reusable React components for flagship forms features and
          engineered APIs in Java and C++.
        </p>

        <h2>Skills</h2>
        <p>
          JavaScript, TypeScript, React 19, React Router v7, Node.js, AWS
          Lambda, AWS CDK, AWS Bedrock, AgentCore, MCP, Java, C++, Jest,
          Cypress, CI/CD, WCAG 2.1 Accessibility
        </p>

        <h2>Education</h2>
        <p>
          MS in Information Systems – Northeastern University (GPA 3.71) · BSc
          in Business Informatics – FH Technikum Wien (GPA 3.7)
        </p>

        <h2>Contact</h2>
        <p>
          <a href="https://www.linkedin.com/in/archil-l">LinkedIn</a> ·{" "}
          <a href="https://github.com/archil-l">GitHub</a>
        </p>
      </noscript>
      <Welcome
        streamingEndpoint={streamingEndpoint}
        mcpProxyEndpoint={mcpProxyEndpoint}
      />
    </>
  );
}
