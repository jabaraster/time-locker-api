tsc \
&& cd sam-app \
&& sam build \
&& sam package --template-file        ./.aws-sam/build/template.yaml \
               --output-template-file ./.aws-sam/build/packaged.yaml \
               --s3-bucket            jabara-sam-packages \
&& sam deploy --template-file ./.aws-sam/build/packaged.yaml \
              --stack-name    time-locker-analyzer \
              --capabilities  CAPABILITY_IAM \
              --parameter-overrides \
                              evernoteToken=$EVERNOTE_TOKEN \
                              evernoteConsumerKey=$EVERNOTE_CONSUMER_KEY \
                              evernoteConsumerSecret=$EVERNOTE_CONSUMER_SECRET \
&& cd ..