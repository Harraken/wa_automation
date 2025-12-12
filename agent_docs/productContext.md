# Product Context: wa-provisioner-ui

## Why This Project Exists
This project automates WhatsApp account provisioning at scale. It eliminates manual work involved in:
- Purchasing phone numbers
- Registering WhatsApp accounts
- Receiving and entering OTP codes
- Managing multiple WhatsApp sessions

## What Problems It Solves
1. **Manual Provisioning Overhead**: Automates the entire flow from number purchase to active WhatsApp session
2. **OTP Handling**: Automatically retrieves OTP from SMS-MAN and injects into emulator
3. **Session Management**: Provides centralized UI to monitor and control multiple WhatsApp sessions
4. **Visual Access**: Real-time streaming of emulator screens via noVNC
5. **Web Integration**: Optional linking to WhatsApp Web for richer DOM parsing capabilities

## How It Should Work
1. User clicks "Provision" in UI → API buys number from SMS-MAN
2. System spawns Android emulator container with WhatsApp
3. Agent automates WhatsApp registration flow via Appium
4. System polls SMS-MAN for OTP, auto-injects into emulator
5. Session becomes active and appears in UI sidebar
6. User can view emulator stream and send/receive messages
7. Optional: System can link session to WhatsApp Web via QR code OCR

## Target Users
- Developers building WhatsApp automation
- Businesses needing multiple WhatsApp accounts
- Testing teams requiring WhatsApp environments



