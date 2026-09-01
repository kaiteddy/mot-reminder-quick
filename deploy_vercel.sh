#!/bin/bash
export VERCEL_ORG_ID="team_XiKTCmfRsqhIW4lb4CLpnZlc"
export VERCEL_PROJECT_ID="prj_2TQcDMjOTbVAvbncFHHv2nEzGWTn"

# Build the project locally to ensure fresh code
echo "Building project..."
pnpm run build

# Build the command with all environment variables
CMD="pnpm dlx vercel deploy --prod --token $1 --yes"

# System configuration
CMD="$CMD --build-env ENABLE_EXPERIMENTAL_COREPACK=1"
CMD="$CMD --build-env NODE_VERSION=22"

# Critical VITE build variables
CMD="$CMD --build-env VITE_OAUTH_PORTAL_URL='https://manus.im'"
CMD="$CMD --build-env VITE_APP_ID='CfLpVpWrxXxSPd5gXqPACt'"
CMD="$CMD --build-env VITE_APP_TITLE='MOT Reminder Quick App'"
CMD="$CMD --build-env VITE_APP_LOGO='https://files.manuscdn.com/user_upload_by_module/web_dev_logo/105027644/ysXwbveFRopTRJEM.png'"
CMD="$CMD --build-env VITE_FRONTEND_FORGE_API_URL='https://forge.manus.ai'"
CMD="$CMD --build-env VITE_FRONTEND_FORGE_API_KEY='gSTHXukeQma2yAvEKAw33S'"
CMD="$CMD --build-env VITE_ANALYTICS_WEBSITE_ID='ee63bbe4-c871-49e6-af32-1f7625b5ec6c'"
CMD="$CMD --build-env VITE_ANALYTICS_ENDPOINT='https://manus-analytics.com'"

# Runtime variables
# SECRETS ARE READ FROM THE ENVIRONMENT — never hardcode them here (this file is committed and
# the repo is public). Export them in your shell before running, or manage them in the Vercel
# dashboard (preferred: they persist across deploys). Fail closed if a required secret is missing.
for v in DATABASE_URL JWT_SECRET ADMIN_PASSWORD BUILT_IN_FORGE_API_KEY; do
  if [ -z "${!v}" ]; then echo "Error: $v is not set in the environment"; exit 1; fi
done
CMD="$CMD --env DATABASE_URL=\"$DATABASE_URL\""
CMD="$CMD --env JWT_SECRET=\"$JWT_SECRET\""
CMD="$CMD --env OAUTH_SERVER_URL='https://api.manus.im'"
CMD="$CMD --env OWNER_OPEN_ID='9xXyagTsBbwvfSi85rALAq'"
CMD="$CMD --env BUILT_IN_FORGE_API_URL='https://forge.manus.ai'"
CMD="$CMD --env BUILT_IN_FORGE_API_KEY=\"$BUILT_IN_FORGE_API_KEY\""
CMD="$CMD --env ADMIN_PASSWORD=\"$ADMIN_PASSWORD\""
# Optional: workshop-staff login (a smaller view). Uncomment after setting STAFF_PASSWORD.
# [ -n "$STAFF_PASSWORD" ] && CMD="$CMD --env STAFF_PASSWORD=\"$STAFF_PASSWORD\""


# Twilio Secrets
# Ensure these variables are set in your environment before running
if [ -z "$TWILIO_ACCOUNT_SID" ]; then echo "Error: TWILIO_ACCOUNT_SID is not set"; exit 1; fi
CMD="$CMD --env TWILIO_ACCOUNT_SID='$TWILIO_ACCOUNT_SID'"
CMD="$CMD --env TWILIO_AUTH_TOKEN='$TWILIO_AUTH_TOKEN'"
CMD="$CMD --env TWILIO_WHATSAPP_NUMBER='$TWILIO_WHATSAPP_NUMBER'"
CMD="$CMD --env TWILIO_MESSAGING_SERVICE_SID='$TWILIO_MESSAGING_SERVICE_SID'"

# DVLA/DVSA Secrets
CMD="$CMD --env DVLA_API_KEY='$DVLA_API_KEY'"
CMD="$CMD --env DVSA_API_KEY='$DVSA_API_KEY'"
CMD="$CMD --env DVSA_CLIENT_ID='$DVSA_CLIENT_ID'"
CMD="$CMD --env DVSA_CLIENT_SECRET='$DVSA_CLIENT_SECRET'"
CMD="$CMD --env DVSA_TOKEN_URL='$DVSA_TOKEN_URL'"
CMD="$CMD --env DVSA_SCOPE_URL='$DVSA_SCOPE_URL'"

# Run the command
eval $CMD

