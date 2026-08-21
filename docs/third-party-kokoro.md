# Kokoro local speech assets

VibeSurfer packages the Apache-2.0 licensed `onnx-community/Kokoro-82M-v1.0-ONNX`
q8 model and the selected `af_heart` voice at commit
`468588286ebb2dd77c25b9771e5d165896538cce`. The files are downloaded during
the build, verified against pinned SHA-256 digests, excluded from git, and made
available only to the trusted local speech worker. Remote model loading is
disabled at runtime.

Source: https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX

License: Apache-2.0
