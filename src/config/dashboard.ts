import type { DashboardConfig } from '@/types/dashboard';

const config: DashboardConfig = {
  "clientId": "2f02a4252a5a4ab68b974c6fddea0068",
  "clientName": "Rocky Mountain Wireline Service",
  "clientDomain": "rmws.com",
  "clientEmail": "theron.chepko@rmws.com",
  "enabledWidgets": [
    "links",
    "siteAnalytics"
  ],
  "tutorialVideos": [],
  "links": [
    {
      "label": "Live Site",
      "url": "https://rmws.com",
      "emoji": "🌐"
    },
    {
      "label": "Sanity Studio",
      "url": "https://studio.rmws.com",
      "emoji": "✏️",
      "description": "Edit your content"
    }
  ],
  "contentEditors": [],
  "analytics": {
    "provider": "ga4",
    "analyticsId": "G-KQZRGVYZ06"
  },
  "contentKit": {
    "enabled": true,
    "sections": [
      {
        "id": "your_business",
        "label": "Your Business",
        "description": "Business name, tagline, industry, location, years in business",
        "enabled": true,
        "required": true
      },
      {
        "id": "services_products",
        "label": "Services / Products",
        "description": "What you offer — repeatable entries with name, description, price range",
        "enabled": true,
        "required": true
      },
      {
        "id": "your_story",
        "label": "Your Story",
        "description": "Origin story, mission statement, values, team members",
        "enabled": true,
        "required": false
      },
      {
        "id": "your_customers",
        "label": "Your Customers",
        "description": "Testimonials, client logos, case studies",
        "enabled": true,
        "required": false
      },
      {
        "id": "brand_style",
        "label": "Brand & Style",
        "description": "Logo upload, brand personality, inspiration photos",
        "enabled": true,
        "required": true
      },
      {
        "id": "practical_details",
        "label": "Practical Details",
        "description": "Phone, email, address, hours, social links",
        "enabled": true,
        "required": true
      },
      {
        "id": "your_goals",
        "label": "Your Goals",
        "description": "Primary website goal, secondary goals, target audience",
        "enabled": true,
        "required": true
      }
    ],
    "maxPersonalityPicks": 4,
    "welcomeMessage": "",
    "completionEmailNotify": true
  }
};

export default config;
